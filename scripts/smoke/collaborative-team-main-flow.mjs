import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
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
  const rootTaskId = invoked.task_id;
  console.log(`root_task_id: ${rootTaskId}`);

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
  const completedItems = workItems.filter((wi) => wi.status === 'completed');
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

  // Every member Task and its latest/current Run must be terminal at root success.
  const memberTaskRows = await db.query(
    `SELECT m.name, m.id AS member_id, t.id AS task_id, t.status AS task_status,
            r.id AS run_id, r.status AS run_status
       FROM team_member_runs m
       LEFT JOIN tasks t ON t.root_task_id=$1
         AND t.logical_step_key = 'member:' || $2::text || ':' || m.id::text || ':member_work'
       LEFT JOIN LATERAL (
         SELECT id, status FROM runs WHERE task_id=t.id ORDER BY attempt DESC LIMIT 1
       ) r ON true
      WHERE m.team_run_id=$2::uuid AND m.role='member'
      ORDER BY m.name`,
    [rootTaskId, teamRunResult.id],
  );
  console.log(`member_task_run_states: ${JSON.stringify(memberTaskRows.rows)}`);
  if (
    memberTaskRows.rows.length !== 2 ||
    memberTaskRows.rows.some(
      (row) =>
        !['completed', 'failed', 'cancelled'].includes(row.task_status) ||
        !['succeeded', 'failed', 'timed_out', 'cancelled'].includes(
          row.run_status,
        ),
    )
  )
    throw new Error(
      `member_task_or_run_not_terminal: ${JSON.stringify(memberTaskRows.rows)}`,
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
} finally {
  if (process.env.PRESERVE_COLLAB_SMOKE === '1') {
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
    }
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('root_timeout');
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
      ? 'Create two distinct research work items for the Analyst and Verifier using team_task_create, then wait. During finalization, return a plain-text synthesis of the completed work; do not call team_complete.'
      : `When assigned a work item, claim it with team_task_claim, complete the research, and update it as completed with team_task_update. ONLY do ONE work item.`
  }\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n    - ref: agent-server/team-task-create\n      kind: tool\n    - ref: agent-server/team-task-list\n      kind: tool\n    - ref: agent-server/team-task-claim\n      kind: tool\n    - ref: agent-server/team-task-update\n      kind: tool\n    - ref: agent-server/team-members-list\n      kind: tool\n    - ref: agent-server/team-complete\n      kind: tool\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute your assigned role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: collab-team-smoke\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}

function teamYaml(leadAgentId, analystAgentId, verifierAgentId, envVersionId) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: collab-research-team\nspec:\n  environmentVersionId: ${envVersionId}\n  lead:\n    name: lead\n    agentVersionId: ${leadAgentId}\n  roster:\n    - name: analyst\n      agentVersionId: ${analystAgentId}\n    - name: verifier\n      agentVersionId: ${verifierAgentId}\n  coordination:\n    mode: collaborative\n    taskAssignment: lead_or_self_claim\n`;
}
