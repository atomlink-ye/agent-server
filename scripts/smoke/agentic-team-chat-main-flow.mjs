import { randomUUID } from 'node:crypto';
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register as registerTsx } from 'tsx/esm/api';
registerTsx();
import { serve } from '@hono/node-server';
import { Client } from 'pg';
import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
  waitForHttp,
} from '../dev/paseo-process.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const token = `collab-team-${randomUUID()}`;
const foreignToken = `collab-team-foreign-${randomUUID()}`;
const tenantId = 'tenant_collab_team_smoke';
const principalId = 'svc_collab_team_smoke';
const workspaceId = randomUUID();
const dbName = `agent_server_collab_${Date.now()}_${randomUUID().slice(0, 8)}`;
const runtimeRoot = join(
  root,
  '.local',
  'collab-team-smoke',
  `${process.pid}-${randomUUID().slice(0, 8)}`,
);
const projectCwd = join(runtimeRoot, 'project');
const cellRoot = join(runtimeRoot, 'cells');
const STAGES = new Set([
  'lead_command',
  'attempt1_materialized',
  'attempt1_terminal',
  'rework_command',
  'attempt2_terminal',
  'completion',
  'full',
]);
const stage = process.env.AGENTIC_TEAM_SMOKE_STAGE ?? 'full';
if (!STAGES.has(stage))
  throw new Error(`invalid_agentic_smoke_stage: ${stage}`);
const stageTimeoutMs = Number(
  process.env.AGENTIC_TEAM_SMOKE_STAGE_TIMEOUT_MS ?? 90_000,
);
class FocusedStageComplete extends Error {}
const retainFile = process.env.AGENTIC_TEAM_SMOKE_RETAIN_FILE
  ? resolve(process.env.AGENTIC_TEAM_SMOKE_RETAIN_FILE)
  : null;
const timeline = [];
let rootTaskId;
let retained = false;
let admin;
let db;
let paseo;
let api;
let service;
let apiUrl;
const useOpenCodeGo = Boolean(process.env.OPENCODE_GO_API_KEY);
if (useOpenCodeGo) {
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'opencode-go': {
        npm: '@ai-sdk/openai-compatible',
        name: 'OpenCode Go',
        options: {
          baseURL: 'https://opencode.ai/zen/go/v1',
          apiKey: '{env:OPENCODE_GO_API_KEY}',
        },
        models: {
          'deepseek-v4-flash': { name: 'deepseek-v4-flash' },
        },
      },
    },
  });
}

try {
  if (!adminUrl) throw new Error('missing_POSTGRES_ADMIN_URL');
  const adminParsed = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(adminParsed.protocol))
    throw new Error('admin_url_protocol');
  if (!adminParsed.pathname || adminParsed.pathname === '/')
    throw new Error('admin_database_missing');
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;
  db = new Client({ connectionString: dbUrl.toString() });
  await mkdir(projectCwd, { recursive: true });
  const paseoPort = await getAvailablePort();
  paseo = await startPaseo({
    repositoryRoot: root,
    runtimeRoot,
    port: paseoPort,
    environmentVariableNames: useOpenCodeGo
      ? ['OPENCODE_GO_API_KEY', 'OPENCODE_CONFIG_CONTENT']
      : [],
  });
  const apiPort = await getAvailablePort();
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(apiPort);
  process.env.DATABASE_URL = dbUrl.toString();
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
  process.env.PASEO_WS_URL = paseo.wsUrl;
  process.env.PASEO_AGENT_CWD = projectCwd;
  process.env.PASEO_RUNTIME_CELL_ROOT = cellRoot;
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = join(runtimeRoot, 'skills');
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: principalId,
      token,
      tenantId,
      workspaceId,
      policyVersion: 'collab-team-smoke-v1',
    },
    {
      serviceAccountId: `${principalId}_foreign`,
      token: foreignToken,
      tenantId: 'tenant_collab_team_foreign',
      workspaceId: randomUUID(),
      policyVersion: 'collab-team-smoke-v1',
    },
  ]);
  const { loadConfig } = await import('../../src/shared/config.ts');
  const { createLogger } =
    await import('../../src/shared/observability/logger.ts');
  const { createService } = await import('../../src/bootstrap.ts');
  const config = loadConfig();
  service = await createService(
    config,
    createLogger({
      service: config.serviceName,
      minimumLevel: config.logLevel,
      write: () => undefined,
    }),
  );
  await service.runtime.initialize();
  api = serve({
    fetch: service.app.fetch,
    hostname: '127.0.0.1',
    port: apiPort,
  });
  apiUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(`${apiUrl}/health/ready`, 90_000);
  await db.connect();
  await db.query(
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',
    [
      workspaceId,
      tenantId,
      'service_account',
      principalId,
      'Collab Team Smoke',
    ],
  );

  // ---- Import and publish 3 Agents ----
  const agents = [];
  for (const name of ['lead', 'analyst', 'verifier']) {
    const imported = await request('/api/v1/agents:import', {
      method: 'POST',
      body: { source: agentYaml(name) },
      idempotencyKey: randomUUID(),
      status: 201,
    });
    await request(`/api/v1/agent-versions/${imported.version.id}:publish`, {
      method: 'POST',
      body: {},
      idempotencyKey: randomUUID(),
      status: 200,
    });
    agents.push({ name, versionId: imported.version.id });
  }

  // ---- Import and publish Environment ----
  const env = await request('/api/v1/environments:import', {
    method: 'POST',
    body: { source: environmentYaml() },
    idempotencyKey: randomUUID(),
    status: 201,
  });
  await request(`/api/v1/environment-versions/${env.version.id}:publish`, {
    method: 'POST',
    body: {},
    idempotencyKey: randomUUID(),
    status: 200,
  });

  // ---- Import and publish collaborative Team via API ----
  const leadAgent = agents.find((a) => a.name === 'lead');
  const analystAgent = agents.find((a) => a.name === 'analyst');
  const verifierAgent = agents.find((a) => a.name === 'verifier');
  if (!leadAgent || !analystAgent || !verifierAgent)
    throw new Error('missing_agent_versions');
  const teamPackage = teamYaml(
    leadAgent.versionId,
    analystAgent.versionId,
    verifierAgent.versionId,
    env.version.id,
  );
  const teamImportKey = randomUUID();
  const teamImported = await request('/api/v1/teams:import', {
    method: 'POST',
    body: { source: teamPackage },
    idempotencyKey: teamImportKey,
    status: 201,
  });
  const teamImportReplay = await request('/api/v1/teams:import', {
    method: 'POST',
    body: { source: teamPackage },
    idempotencyKey: teamImportKey,
    status: 201,
  });
  if (teamImportReplay.version.id !== teamImported.version.id)
    throw new Error('team_import_idempotency_did_not_replay');
  const teamPublishKey = randomUUID();
  const teamPublished = await request(
    `/api/v1/team-versions/${teamImported.version.id}:publish`,
    {
      method: 'POST',
      body: {},
      idempotencyKey: teamPublishKey,
      status: 200,
    },
  );
  const teamPublishReplay = await request(
    `/api/v1/team-versions/${teamImported.version.id}:publish`,
    { method: 'POST', body: {}, idempotencyKey: teamPublishKey, status: 200 },
  );
  if (teamPublishReplay.id !== teamPublished.id)
    throw new Error('team_publish_idempotency_did_not_replay');
  console.log(`team_version_id: ${teamPublished.id}`);

  // ---- Invoke Team ----
  const invoked = await request('/api/v1/tasks:invoke', {
    method: 'POST',
    body: {
      invokable: { kind: 'team', version_id: teamPublished.id },
      input: {
        text: 'Lead: create two research tasks for the analyst and verifier, then synthesize their results.',
      },
    },
    idempotencyKey: randomUUID(),
    status: 202,
  });
  rootTaskId = invoked.task_id;
  console.log(`root_task_id: ${rootTaskId}`);

  if (stage !== 'full') {
    await pollFocusedStage(rootTaskId, stage);
    console.log(JSON.stringify({ status: 'passed', stage }));
    throw new FocusedStageComplete();
  }

  // ---- Poll root task to terminal ----
  const rootResult = await poll(rootTaskId);
  if (rootResult.status !== 'completed') {
    throw new Error(`root_not_completed: ${rootResult.status}`);
  }
  console.log('root_task: completed');

  // ---- Verify task tree ----
  const children = await pollCollaborativeChildren(rootTaskId);
  console.log(`child_tasks_in_tree: ${children.length}`);

  // ---- Verify TeamRun ----
  const teamRunResult = await request(`/api/v1/tasks/${rootTaskId}/team-run`, {
    method: 'GET',
    status: 200,
  });
  if (!teamRunResult) throw new Error('team_run_not_found');
  console.log(`team_run_id: ${teamRunResult.id}`);
  console.log(`team_run_status: ${teamRunResult.status}`);
  if (teamRunResult.status !== 'succeeded' || teamRunResult.phase !== 'done')
    throw new Error(
      `team_not_succeeded: status=${teamRunResult.status} phase=${teamRunResult.phase}`,
    );

  // ---- Verify TeamRun members ----
  const members = await request(
    `/api/v1/team-runs/${teamRunResult.id}/members`,
    {
      method: 'GET',
      status: 200,
    },
  );
  const roles = members.map((m) => m.role);
  const leadMembers = members.filter((m) => m.role === 'lead');
  console.log(`members: ${JSON.stringify(roles)}`);
  if (!roles.includes('lead')) throw new Error('no_lead_member');
  if (!roles.includes('member')) throw new Error('no_member_member');
  if (members.length !== 3)
    throw new Error(`expected_3_members: ${members.length}`);
  if (leadMembers.length !== 1)
    throw new Error(`expected_single_lead_member: ${leadMembers.length}`);
  const [leadMember] = leadMembers;
  const memberNames = members
    .filter((m) => m.role === 'member')
    .map((m) => m.name);
  if (
    new Set(memberNames).size !== 2 ||
    memberNames.some((name) => ['researcher', 'critic'].includes(name))
  )
    throw new Error(`unexpected_member_names: ${JSON.stringify(memberNames)}`);

  // ---- Verify WorkItems ----
  const workItems = await request(
    `/api/v1/team-runs/${teamRunResult.id}/tasks`,
    { method: 'GET', status: 200 },
  );
  console.log(`work_items: ${workItems.length}`);
  const completedItems = workItems.filter((wi) =>
    ['completed', 'accepted'].includes(wi.status),
  );
  const leadWorkItems = workItems.filter(
    (wi) => wi.created_by_member_id === leadMember.id,
  );
  console.log(`completed_work_items: ${completedItems.length}`);
  if (
    workItems.length !== 2 ||
    leadWorkItems.length !== 2 ||
    completedItems.length !== workItems.length
  )
    throw new Error(
      `work_items_not_completed: total=${workItems.length} lead=${leadWorkItems.length} completed=${completedItems.length}`,
    );

  // ---- Verify runtime sessions (via DB inspection) ----
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const runtimeSessions = await db.query(
    `SELECT m.id AS member_id, m.name, m.role, m.status, m.runtime_session_id,
            r.scope_kind, r.provider_agent_id
       FROM team_member_runs m
       LEFT JOIN runtime_sessions r ON r.id = m.runtime_session_id
      WHERE m.team_run_id=$1
      ORDER BY m.name`,
    [teamRunResult.id],
  );
  const linkedMembers = runtimeSessions.rows.filter(
    (r) => r.runtime_session_id !== null,
  );
  if (
    runtimeSessions.rows.length !== 3 ||
    linkedMembers.length !== 3 ||
    linkedMembers.some(
      (r) =>
        r.scope_kind !== 'team_member' ||
        !['idle', 'stopped'].includes(r.status),
    )
  )
    throw new Error(
      `expected_three_linked_team_member_runtime_sessions: ${JSON.stringify(runtimeSessions.rows)}`,
    );
  if (new Set(linkedMembers.map((r) => r.provider_agent_id)).size !== 3)
    throw new Error('expected_distinct_member_provider_bindings');
  const memberIntervals = await db.query(
    `SELECT m.name AS member_name,
            MIN(e.created_at) FILTER (WHERE e.type='started') AS started_at,
            COALESCE(
              MAX(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed')),
              MAX(r.updated_at) FILTER (WHERE r.status IN ('succeeded','failed','cancelled'))
            ) AS terminal_at
       FROM team_member_runs m
       JOIN tasks t ON t.root_task_id=$1 AND t.logical_step_key = 'member:' || $2::text || ':' || m.id::text || ':member_work'
       JOIN runs r ON r.task_id=t.id
       JOIN run_events e ON e.run_id=r.id
      WHERE m.team_run_id=$2::uuid AND m.role='member'
      GROUP BY m.name`,
    [rootTaskId, teamRunResult.id],
  );
  const intervals = memberIntervals.rows.filter(
    (r) => r.started_at !== null && r.terminal_at !== null,
  );
  if (intervals.length < 2)
    throw new Error('member_execution_intervals_missing');
  const latestStart = Math.max(
    ...intervals.map((r) => Date.parse(r.started_at)),
  );
  const earliestEnd = Math.min(
    ...intervals.map((r) => Date.parse(r.terminal_at)),
  );
  if (latestStart >= earliestEnd)
    throw new Error('member_execution_intervals_do_not_overlap');
  const leadExecutions = await db.query(
    `SELECT t.logical_step_key, rs.scope_kind, rs.provider_agent_id
       FROM tasks t
       JOIN runs r ON r.task_id=t.id
       LEFT JOIN runtime_sessions rs ON rs.task_id=t.id
      WHERE t.root_task_id=$1 AND t.logical_step_key LIKE 'lead:%'
      ORDER BY t.logical_step_key, r.attempt DESC`,
    [rootTaskId],
  );
  const kickoffExecution = leadExecutions.rows.find((r) =>
    r.logical_step_key.endsWith(':kickoff'),
  );
  const finalizationExecution = leadExecutions.rows.find((r) =>
    r.logical_step_key.endsWith(':finalize'),
  );
  if (
    !kickoffExecution ||
    !finalizationExecution ||
    kickoffExecution.scope_kind !== 'team_member' ||
    finalizationExecution.scope_kind !== 'task' ||
    !kickoffExecution.provider_agent_id ||
    !finalizationExecution.provider_agent_id ||
    kickoffExecution.provider_agent_id ===
      finalizationExecution.provider_agent_id
  )
    throw new Error(
      `lead_runtime_scope_provider_not_isolated: ${JSON.stringify(leadExecutions.rows)}`,
    );
  const rootEvents = await db.query(
    `SELECT type,payload FROM run_events WHERE run_id=$1 AND type IN ('output','succeeded')`,
    [teamRunResult.root_run_id],
  );
  if (
    !rootEvents.rows.some((r) => r.type === 'output') ||
    !rootEvents.rows.some((r) => r.type === 'succeeded')
  )
    throw new Error('root_completion_events_missing');
  const finalizationRun = await db.query(
    `SELECT r.status, r.result
       FROM runs r
       JOIN tasks t ON t.id=r.task_id
      WHERE t.root_task_id=$1 AND t.logical_step_key LIKE 'lead:%:finalize'
      ORDER BY r.attempt DESC LIMIT 1`,
    [rootTaskId],
  );
  const finalText = finalizationRun.rows[0]?.result?.text?.trim();
  console.log(
    `lead_finalization_run: ${JSON.stringify({ status: finalizationRun.rows[0]?.status, has_result_text: Boolean(finalText) })}`,
  );
  if (finalizationRun.rows[0]?.status !== 'succeeded' || !finalText)
    throw new Error('lead_finalization_plain_text_missing');
  await request(`/api/v1/team-runs/${teamRunResult.id}`, {
    method: 'GET',
    status: 404,
    authToken: foreignToken,
  });
  const logicalSteps = children.map((t) => t.logical_step_key).filter(Boolean);
  if (new Set(logicalSteps).size !== logicalSteps.length)
    throw new Error('duplicate_logical_step_tasks');
  const allRuntimeSessions = await db.query(
    `SELECT scope_kind, scope_id FROM runtime_sessions WHERE tenant_id=$1`,
    [tenantId],
  );
  const teamMemberSessions = allRuntimeSessions.rows.filter(
    (r) => r.scope_kind === 'team_member',
  );
  console.log(`team_member_runtime_sessions: ${teamMemberSessions.length}`);

  const agenticEvidence = await db.query(
    `SELECT tr.lead_turn_count, COUNT(DISTINCT a.work_item_id) AS work_items, COUNT(*) AS attempts, COUNT(*) FILTER (WHERE a.attempt_no=2) AS rework_attempts, COUNT(*) FILTER (WHERE a.status='completed') AS completed_attempts, COUNT(DISTINCT a.execution_task_id) AS linked_attempt_tasks FROM team_runs tr LEFT JOIN team_work_item_attempts a ON a.team_run_id=tr.id WHERE tr.id=$1 GROUP BY tr.id`,
    [teamRunResult.id],
  );
  const evidence = agenticEvidence.rows[0];
  if (Number(evidence.lead_turn_count) < 2)
    throw new Error('agentic_lead_turns_missing');
  if (Number(evidence.work_items) < 1 || Number(evidence.attempts) < 2)
    throw new Error('agentic_attempts_missing');
  if (Number(evidence.rework_attempts) < 1)
    throw new Error('agentic_rework_missing');
  if (Number(evidence.completed_attempts) !== Number(evidence.attempts))
    throw new Error('agentic_attempt_not_completed');
  if (Number(evidence.linked_attempt_tasks) !== Number(evidence.attempts))
    throw new Error('agentic_attempt_task_linkage_missing');
  console.log(`agentic_evidence: ${JSON.stringify(evidence)}`);

  if (retainFile) {
    const temp = `${retainFile}.tmp-${process.pid}`;
    await mkdir(resolve(retainFile, '..'), { recursive: true });
    await writeFile(
      temp,
      `${JSON.stringify({
        status: 'retained-ready',
        root_task_id: rootTaskId,
        team_run_id: teamRunResult.id,
        db_name: dbName,
        api_url: apiUrl,
        runtime_root: '<runtime-root>',
        timeline,
        evidence,
      })}\n`,
      { mode: 0o600 },
    );
    await rename(temp, retainFile);
    retained = true;
    console.log(
      JSON.stringify({
        status: 'retained-ready',
        root_task_id: rootTaskId,
        team_run_id: teamRunResult.id,
      }),
    );
    await new Promise(() => {});
  }

  // ---- Final output ----
  console.log(
    JSON.stringify({
      status: 'passed',
      root_task: 'completed',
      child_tasks: children.length,
      lead_work_items: leadWorkItems.length,
      dynamic_work_items: leadWorkItems.length === 2,
      member_runtime_sessions: teamMemberSessions.length,
      phases: 'lead_kickoff -> member_work -> lead_finalize -> done',
      team_run_status: teamRunResult.status,
    }),
  );
} catch (error) {
  if (!(error instanceof FocusedStageComplete)) throw error;
} finally {
  if (retained || process.env.PRESERVE_COLLAB_SMOKE === '1') {
    console.error(`preserved_db: ${dbName}`);
    console.error(`preserved_runtime_root: ${runtimeRoot}`);
    process.exitCode = 1;
  } else {
    await new Promise(
      (resolveClose) => api?.close?.(() => resolveClose()) ?? resolveClose(),
    ).catch(() => undefined);
    await service?.close?.().catch(() => undefined);
    await db?.end().catch(() => undefined);
    await admin
      ?.query(`DROP DATABASE IF EXISTS "${dbName.replaceAll('"', '""')}"`)
      .catch(() => undefined);
    await admin?.end().catch(() => undefined);
    await (
      paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()
    ).catch(() => undefined);
    await rm(runtimeRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function request(path, options) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${options.authToken ?? token}`,
      'content-type': 'application/json',
      'idempotency-key': options.idempotencyKey ?? '',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status !== options.status) {
    const detail = body?.error?.message ?? `http_${response.status}`;
    throw new Error(
      `http_${response.status}_expected_${options.status}: ${detail}`,
    );
  }
  return body;
}

async function poll(taskId) {
  const deadline =
    Date.now() + Number(process.env.COLLAB_SMOKE_POLL_MS ?? 600_000);
  const startedAt = Date.now();
  let lastStatus;
  let lastLoggedAt = 0;
  while (Date.now() < deadline) {
    const task = await request(`/api/v1/tasks/${taskId}`, {
      method: 'GET',
      status: 200,
    });
    const now = Date.now();
    if (task.status !== lastStatus || now - lastLoggedAt >= 10_000) {
      console.log(
        `root_task_status: ${task.status} elapsed_seconds: ${Math.floor((now - startedAt) / 1000)}`,
      );
      lastStatus = task.status;
      lastLoggedAt = now;
      timeline.push({
        at: new Date(now).toISOString(),
        root_status: task.status,
        latest_run_status: task.latest_run?.status ?? null,
      });
    }
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('root_timeout');
}

async function pollFocusedStage(taskId, requestedStage) {
  const deadline = Date.now() + stageTimeoutMs;
  let lastSnapshot;
  while (Date.now() < deadline) {
    lastSnapshot = await focusedSnapshot(taskId);
    if (focusedStageSatisfied(requestedStage, lastSnapshot)) {
      console.log(
        JSON.stringify({
          status: 'passed',
          stage: requestedStage,
          elapsed_ms: stageTimeoutMs - Math.max(0, deadline - Date.now()),
          snapshot: lastSnapshot,
        }),
      );
      return;
    }
    if (requestedStage === 'lead_command' && lastSnapshot.leadTerminal) {
      console.log(
        JSON.stringify({
          status: 'failed',
          stage: requestedStage,
          reason: 'lead_terminal_before_command_receipt',
          snapshot: lastSnapshot,
        }),
      );
      throw new Error('lead_command_stage_failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(
    JSON.stringify({
      status: 'failed',
      stage: requestedStage,
      reason: 'stage_timeout',
      snapshot: lastSnapshot ?? (await focusedSnapshot(taskId)),
    }),
  );
  throw new Error(`agentic_stage_timeout: ${requestedStage}`);
}

async function focusedSnapshot(taskId) {
  const team = await db.query(
    `SELECT id,status,execution_mode,control_state,revision,lead_turn_count,phase
       FROM team_runs WHERE root_task_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [taskId],
  );
  const teamRun = team.rows[0] ?? null;
  const tasks = await db.query(
    `SELECT t.id,t.team_task_kind,t.logical_step_key,t.status AS task_status,
            r.id AS run_id,r.status AS run_status,r.lease_expires_at
       FROM tasks t LEFT JOIN runs r ON r.task_id=t.id
      WHERE t.root_task_id=$1 ORDER BY t.created_at`,
    [taskId],
  );
  const receipts = teamRun
    ? await db.query(
        `SELECT command_name FROM team_command_receipts
          WHERE source_run_id IN (SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id
                                   WHERE t.root_task_id=$1)
          ORDER BY created_at`,
        [taskId],
      )
    : { rows: [] };
  const attempts = teamRun
    ? await db.query(
        `SELECT attempt_no,status,execution_task_id,result_summary
           FROM team_work_item_attempts WHERE team_run_id=$1 ORDER BY attempt_no`,
        [teamRun.id],
      )
    : { rows: [] };
  const safeTasks = tasks.rows.map((row) => ({
    task_id: row.id,
    kind: row.team_task_kind,
    logical_step: row.logical_step_key,
    task_status: row.task_status,
    run_id: row.run_id,
    run_status: row.run_status,
    lease_expired:
      row.lease_expires_at !== null &&
      Date.parse(row.lease_expires_at) < Date.now(),
  }));
  return {
    team_run: teamRun
      ? {
          status: teamRun.status,
          execution_mode: teamRun.execution_mode,
          control_state: teamRun.control_state,
          revision: Number(teamRun.revision),
          lead_turns: Number(teamRun.lead_turn_count),
          phase: teamRun.phase,
        }
      : null,
    tasks_runs: safeTasks,
    receipt_names: receipts.rows.map((row) => row.command_name),
    attempts: attempts.rows.map((row) => ({
      attempt_no: Number(row.attempt_no),
      status: row.status,
      materialized: row.execution_task_id !== null,
      has_result: Boolean(row.result_summary),
    })),
    lease_expired: safeTasks.some((row) => row.lease_expired),
    leadTerminal: safeTasks.some(
      (row) =>
        row.kind === 'lead_turn' &&
        ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(
          row.run_status,
        ),
    ),
  };
}

function focusedStageSatisfied(requestedStage, snapshot) {
  const receipts = new Set(snapshot.receipt_names);
  const attempts = snapshot.attempts;
  if (requestedStage === 'lead_command')
    return Boolean(
      snapshot.team_run?.execution_mode === 'agentic_mve' &&
      snapshot.tasks_runs.some((row) => row.kind === 'lead_turn') &&
      snapshot.tasks_runs.some(
        (row) => row.kind === 'lead_turn' && row.run_id,
      ) &&
      [...receipts].some((name) => name.startsWith('team_')),
    );
  if (requestedStage === 'attempt1_materialized')
    return attempts.some((row) => row.attempt_no === 1 && row.materialized);
  if (requestedStage === 'attempt1_terminal')
    return attempts.some(
      (row) =>
        row.attempt_no === 1 && ['completed', 'failed'].includes(row.status),
    );
  if (requestedStage === 'rework_command')
    return receipts.has('team_work_request_rework');
  if (requestedStage === 'attempt2_terminal')
    return attempts.some(
      (row) =>
        row.attempt_no === 2 && ['completed', 'failed'].includes(row.status),
    );
  if (requestedStage === 'completion')
    return (
      receipts.has('team_completion_request') ||
      snapshot.team_run?.status === 'succeeded'
    );
  return false;
}

async function pollCollaborativeChildren(rootTaskId) {
  const deadline = Date.now() + 15_000;
  const startedAt = Date.now();
  let lastSignature;
  while (Date.now() < deadline) {
    const tree = await request(`/api/v1/tasks/${rootTaskId}/tree`, {
      method: 'GET',
      status: 200,
    });
    const children = tree.tasks.filter((t) => t.task_id !== rootTaskId);
    const signature = children
      .map(({ task_id, status }) => `${task_id}:${status}`)
      .join(',');
    if (signature !== lastSignature) {
      console.log(
        `child_task_status: ${signature || 'none'} elapsed_seconds: ${Math.floor((Date.now() - startedAt) / 1000)}`,
      );
      lastSignature = signature;
    }
    if (
      children.length > 0 &&
      children.every((task) => task.status === 'completed')
    ) {
      return children;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const tree = await request(`/api/v1/tasks/${rootTaskId}/tree`, {
    method: 'GET',
    status: 200,
  });
  const children = tree.tasks.filter((t) => t.task_id !== rootTaskId);
  throw new Error(
    `child_tasks_not_completed: ${JSON.stringify(children.map(({ task_id, status }) => ({ task_id, status })))}`,
  );
}

function agentYaml(name) {
  const displayName =
    name === 'lead' ? 'Lead' : name === 'analyst' ? 'Analyst' : 'Verifier';
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: collab-smoke-${name}\nspec:\n  description: Collaborative team smoke ${displayName}\n  instructions: You are the ${displayName} in a collaborative team. ${
    name === 'lead'
      ? 'Use the agentic Team tools only. Make one current decision per turn, then immediately return a short decision text. Assign work based on the rubric and teammate capabilities; do not assume a fixed work topology. On review, require both a market snapshot and event evidence. Request exactly one bounded rework when the analyst lacks event evidence, then accept only completed attempts with results and request completion.'
      : name === 'analyst'
        ? 'Use the legacy work tools for the assigned item. On the first attempt, claim the item, call synthetic_stock_snapshot only, and complete it with a concise result that explicitly lacks event evidence. If the Lead requests rework, call synthetic_stock_snapshot and synthetic_event_batch, then complete the same item with both evidence categories. ONLY do ONE work item per attempt.'
        : 'When assigned a work item, claim it with team_task_claim, call synthetic_stock_snapshot and synthetic_event_batch, then complete it with a concise result containing both evidence categories. ONLY do ONE work item.'
  }\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n    - ref: agent-server/team-work-create-and-assign\n      kind: tool\n    - ref: agent-server/team-work-accept\n      kind: tool\n    - ref: agent-server/team-work-request-rework\n      kind: tool\n    - ref: agent-server/team-completion-request\n      kind: tool\n    - ref: agent-server/team-task-create\n      kind: tool\n    - ref: agent-server/team-task-list\n      kind: tool\n    - ref: agent-server/team-task-claim\n      kind: tool\n    - ref: agent-server/team-task-update\n      kind: tool\n    - ref: agent-server/team-members-list\n      kind: tool\n    - ref: agent-server/team-complete\n      kind: tool\n    - ref: agent-server/synthetic-stock-snapshot\n      kind: tool\n    - ref: agent-server/synthetic-event-batch\n      kind: tool\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute your assigned role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: collab-team-smoke\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}

function teamYaml(leadAgentId, analystAgentId, verifierAgentId, envVersionId) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: collab-research-team\nspec:\n  environmentVersionId: ${envVersionId}\n  lead:\n    name: lead\n    agentVersionId: ${leadAgentId}\n  roster:\n    - name: analyst\n      agentVersionId: ${analystAgentId}\n    - name: verifier\n      agentVersionId: ${verifierAgentId}\n  coordination:\n    mode: agentic_mve\n    taskAssignment: lead_or_self_claim\n`;
}
