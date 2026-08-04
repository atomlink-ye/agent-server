import { randomUUID } from 'node:crypto';
import {
  mkdir,
  rm,
  rename,
  writeFile,
  readdir,
  readFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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
const AGENTIC_COMMAND_RECEIPTS = new Set([
  'team_work_create',
  'team_work_request_changes',
  'team_work_accept',
  'team_finish',
]);
const SAFE_TOOL_NAMES = new Set([
  'synthetic_stock_snapshot',
  'synthetic_event_batch',
  'team_work_create',
  'team_work_accept',
  'team_work_request_changes',
  'team_finish',
]);
const SAFE_DETAIL_KINDS = new Set([
  'shell',
  'read',
  'edit',
  'write',
  'search',
  'fetch',
  'subagent',
  'other',
]);
const SAFE_PERMISSION_KINDS = new Set([
  'tool',
  'plan',
  'question',
  'mode',
  'other',
]);
const SAFE_PERMISSION_STATUSES = new Set(['requested', 'resolved']);
const SAFE_PERMISSION_DECISIONS = new Set(['allowed', 'denied']);
const SAFE_PERMISSION_SUMMARIES = new Set([
  'Permission activity is read-only.',
]);
const MAX_PERMISSION_EVENTS_PER_RUN = 4;
const SAFE_ERROR_CODES = new Set([
  'runtime_execution_failed',
  'runtime_timed_out',
  'cancelled',
  'terminal_persistence_failed',
]);
const SAFE_RUN_EVENT_TYPES = new Set([
  'started',
  'output',
  'succeeded',
  'failed',
  'cancelled',
]);
const LEGACY_TEAM_TOOL_REFS = new Set([
  'agent-server/team-members-list',
  'agent-server/team-task-create',
  'agent-server/team-task-list',
  'agent-server/team-task-claim',
  'agent-server/team-task-update',
  'agent-server/team-complete',
  'agent-server/team-work-create-and-assign',
  'agent-server/team-work-accept',
  'agent-server/team-work-request-rework',
  'agent-server/team-completion-request',
]);
const CANONICAL_TEAM_TOOL_REFS = new Set([
  'agent-server/team-state',
  'agent-server/team-work-list',
  'agent-server/team-work-create',
  'agent-server/team-work-request-changes',
  'agent-server/team-work-accept-v2',
  'agent-server/team-finish',
  'agent-server/team-work-checkpoint',
  'agent-server/team-work-submit',
]);
const stage = process.env.AGENTIC_TEAM_SMOKE_STAGE ?? 'full';
if (!STAGES.has(stage))
  throw new Error(`invalid_agentic_smoke_stage: ${stage}`);
const stageTimeoutMs = Number(
  process.env.AGENTIC_TEAM_SMOKE_STAGE_TIMEOUT_MS ??
    (stage === 'attempt2_terminal' ? 720_000 : 90_000),
);
if (stage !== 'full')
  process.env.PASEO_EXECUTION_TIMEOUT_MS ??= String(
    Math.min(stageTimeoutMs, 600_000),
  );
class FocusedStageComplete extends Error {}
const retainFile = process.env.AGENTIC_TEAM_SMOKE_RETAIN_FILE
  ? resolve(process.env.AGENTIC_TEAM_SMOKE_RETAIN_FILE)
  : join(root, '.local', 'agentic-team-chat-lead.json');
const timeline = [];
let rootTaskId;
let retained = false;
let admin;
let db;
let paseo;
let api;
let service;
let apiUrl;
let next;
let webUrl;
let bffProject;
let failure;
let failureSnapshot;
let preCleanupArtifactWritten = false;
const cleanupDiagnostics = [];
const useOpenCodeGo = Boolean(process.env.OPENCODE_GO_API_KEY);
if (useOpenCodeGo) {
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    agent: {
      build: {
        permission: 'allow',
      },
    },
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
      write: (line) => {
        const event = JSON.parse(line);
        if (
          typeof event.event === 'string' &&
          (event.event.startsWith('runtime.workspace.create.') ||
            event.event.startsWith('runtime.agent.create.') ||
            event.event.startsWith('runtime.message.send.') ||
            event.event.startsWith('runtime.wait.'))
        )
          console.log(line);
      },
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

  if (stage === 'full') {
    const webPort = process.env.AGENTIC_TEAM_WEB_PORT
      ? validatedPort(process.env.AGENTIC_TEAM_WEB_PORT)
      : await getAvailablePort();
    webUrl = `http://127.0.0.1:${webPort}`;
    next = spawn(
      'pnpm',
      [
        '--dir',
        join(root, 'apps/web'),
        'exec',
        'next',
        'dev',
        '-H',
        '0.0.0.0',
        '-p',
        String(webPort),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          AGENT_SERVER_BASE_URL: apiUrl,
          AGENT_SERVER_SERVICE_TOKEN: token,
          WEB_WORKSPACE_ID: workspaceId,
          WEB_AGENT_VERSION_ID: leadAgent.versionId,
          WEB_AGENTIC_TEAM_VERSION_ID: teamPublished.id,
          WEB_ENVIRONMENT_VERSION_ID: env.version.id,
        },
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );
    await waitForHttp(`${webUrl}/`, 90_000);
  }

  // ---- Invoke Team through the browser-facing BFF in full mode ----
  const invoked =
    stage === 'full'
      ? await webRequest('/api/team-project/runs', {
          method: 'POST',
          body: {},
          status: 202,
        })
      : await request('/api/v1/tasks:invoke', {
          method: 'POST',
          body: {
            invokable: { kind: 'team', version_id: teamPublished.id },
            input: {
              text: 'Lead: create one research task for a member, then synthesize its result.',
            },
          },
          idempotencyKey: randomUUID(),
          status: 202,
        });
  if (stage === 'full') {
    if (!onlyKeys(invoked, ['root_task_id']) || !uuid(invoked.root_task_id))
      throw new Error('team_project_launch_contract_invalid');
    rootTaskId = invoked.root_task_id;
  } else {
    if (!uuid(invoked.task_id)) throw new Error('team_launch_contract_invalid');
    rootTaskId = invoked.task_id;
  }
  console.log(`root_task_id: ${rootTaskId}`);

  if (stage !== 'full') {
    const focused = await pollFocusedStage(rootTaskId, stage);
    await retainFocusedState(focused);
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
  if (new Set(memberNames).size !== 2)
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
    `SELECT m.id AS member_id, m.name, m.role, m.status AS member_status,
            m.runtime_session_id, r.scope_kind,
            r.provider_agent_id, sls.tool_refs AS grant_tool_refs
       FROM team_member_runs m
       LEFT JOIN runtime_sessions r ON r.id = m.runtime_session_id
       LEFT JOIN session_launch_snapshots sls ON sls.id = r.launch_snapshot_id
      WHERE m.team_run_id=$1
      ORDER BY m.name`,
    [teamRunResult.id],
  );
  const linkedMembers = runtimeSessions.rows.filter(
    (r) => r.runtime_session_id !== null,
  );
  const linkedMemberRoles = linkedMembers.map((r) => r.role);
  if (
    runtimeSessions.rows.length !== 3 ||
    linkedMembers.length !== 3 ||
    linkedMemberRoles.filter((role) => role === 'lead').length !== 1 ||
    linkedMemberRoles.filter((role) => role === 'member').length !== 2 ||
    linkedMembers.some(
      (r) =>
        r.scope_kind !== 'team_member' ||
        !r.provider_agent_id ||
        !['idle', 'stopped'].includes(r.member_status),
    )
  )
    throw new Error(
      `expected_three_linked_team_member_runtime_sessions: total=${runtimeSessions.rows.length} linked=${linkedMembers.length}`,
    );
  if (new Set(linkedMembers.map((r) => r.provider_agent_id)).size !== 3)
    throw new Error('expected_distinct_team_member_provider_bindings');
  const grantRefs = new Set(
    linkedMembers.flatMap((row) => safeToolRefs(row.grant_tool_refs)),
  );
  if (
    !grantRefs.size ||
    [...grantRefs].some((ref) => !CANONICAL_TEAM_TOOL_REFS.has(ref))
  )
    throw new Error('team_grant_contains_non_canonical_tool');
  if ([...grantRefs].some((ref) => LEGACY_TEAM_TOOL_REFS.has(ref)))
    throw new Error('legacy_team_tool_grant_present');
  const leadOnlyRefs = new Set([
    'agent-server/team-work-create',
    'agent-server/team-work-request-changes',
    'agent-server/team-work-accept-v2',
    'agent-server/team-finish',
  ]);
  if (
    linkedMembers
      .filter((row) => row.role === 'member')
      .flatMap((row) => safeToolRefs(row.grant_tool_refs))
      .some((ref) => leadOnlyRefs.has(ref))
  )
    throw new Error('member_grant_contains_lead_mutation');
  console.log(
    `team_grants: ${JSON.stringify({ canonical: [...grantRefs].sort(), member_has_lead_mutations: false })}`,
  );
  const workAttemptTasks = await db.query(
    `SELECT t.id,t.status AS task_status,t.team_member_run_id,r.id AS run_id,r.status AS run_status,
            rs.id AS runtime_session_id
       FROM tasks t
       JOIN runs r ON r.task_id=t.id
       LEFT JOIN runtime_sessions rs ON rs.task_id=t.id
      WHERE t.root_task_id=$1 AND t.team_task_kind='work_attempt'
      ORDER BY t.created_at`,
    [rootTaskId],
  );
  const nonLeadMemberIds = new Set(
    members.filter((m) => m.role === 'member').map((m) => m.id),
  );
  const attemptMemberIds = new Set(
    workAttemptTasks.rows.map((row) => row.team_member_run_id),
  );
  if (
    workAttemptTasks.rows.length !== 3 ||
    attemptMemberIds.size !== 2 ||
    workAttemptTasks.rows.some(
      (row) => !nonLeadMemberIds.has(row.team_member_run_id),
    ) ||
    workAttemptTasks.rows.some(
      (row) =>
        row.task_status !== 'completed' || row.run_status !== 'succeeded',
    )
  )
    throw new Error('work_attempt_tasks_not_sequentially_completed');
  const checkpointEvents = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM run_events
      WHERE run_id = ANY($1::uuid[]) AND payload->>'kind'='team_checkpoint'`,
    [workAttemptTasks.rows.map((row) => row.run_id).filter(Boolean)],
  );
  if (Number(checkpointEvents.rows[0]?.count ?? 0) < 3)
    throw new Error('member_checkpoint_evidence_missing');
  console.log(
    `member_work_evidence: ${JSON.stringify({ checkpoints: Number(checkpointEvents.rows[0].count), submitted_attempts: workAttemptTasks.rows.length })}`,
  );
  const attemptCounts = new Map();
  for (const row of workAttemptTasks.rows)
    attemptCounts.set(
      row.team_member_run_id,
      (attemptCounts.get(row.team_member_run_id) ?? 0) + 1,
    );
  if ([...attemptCounts.values()].sort().join(',') !== '1,2')
    throw new Error('expected_one_member_rework_and_one_member_submit');
  const reworkedMemberId = [...attemptCounts.entries()].find(
    ([, count]) => count === 2,
  )?.[0];
  const reworkedRows = workAttemptTasks.rows.filter(
    (row) => row.team_member_run_id === reworkedMemberId,
  );
  if (
    new Set(reworkedRows.map((row) => row.runtime_session_id)).size !== 1 ||
    reworkedRows[0]?.runtime_session_id !==
      linkedMembers.find((row) => row.member_id === reworkedMemberId)
        ?.runtime_session_id
  )
    throw new Error('member_runtime_session_not_reused_for_rework');
  const attemptsForTasks = await db.query(
    `SELECT execution_task_id,COUNT(*) AS count
       FROM team_work_item_attempts
      WHERE team_run_id=$1
      GROUP BY execution_task_id`,
    [teamRunResult.id],
  );
  if (
    attemptsForTasks.rows.length !== 3 ||
    attemptsForTasks.rows.some((row) => Number(row.count) !== 1) ||
    attemptsForTasks.rows.some(
      (row) =>
        !workAttemptTasks.rows.some(
          (task) => task.id === row.execution_task_id,
        ),
    )
  )
    throw new Error('work_attempt_tasks_not_uniquely_linked');
  const leadTurnTasks = await db.query(
    `SELECT t.id,t.status AS task_status,t.team_member_run_id,r.status AS run_status
       FROM tasks t
       JOIN runs r ON r.task_id=t.id
      WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn'
      ORDER BY t.created_at`,
    [rootTaskId],
  );
  if (
    leadTurnTasks.rows.length !== 4 ||
    leadTurnTasks.rows.some(
      (row) =>
        row.team_member_run_id !== leadMember.id ||
        row.task_status !== 'completed' ||
        row.run_status !== 'succeeded',
    )
  )
    throw new Error('lead_turn_tasks_not_completed');
  const leadRuntimeSession = runtimeSessions.rows.find(
    (row) => row.role === 'lead',
  );
  if (
    !leadRuntimeSession?.runtime_session_id ||
    leadRuntimeSession.scope_kind !== 'team_member' ||
    !leadRuntimeSession.provider_agent_id
  )
    throw new Error('lead_reusable_runtime_session_missing');
  const rootEvents = await db.query(
    `SELECT type,payload FROM run_events WHERE run_id=$1 AND type IN ('output','succeeded')`,
    [teamRunResult.root_run_id],
  );
  if (
    !rootEvents.rows.some((r) => r.type === 'output') ||
    !rootEvents.rows.some((r) => r.type === 'succeeded')
  )
    throw new Error('root_completion_events_missing');
  const completionRuns = await db.query(
    `SELECT r.status, (NULLIF(BTRIM(r.result->>'text'),'') IS NOT NULL) AS has_result_text
       FROM team_command_receipts c
       JOIN runs r ON r.id=c.source_run_id
       JOIN tasks t ON t.id=r.task_id
      WHERE c.command_name='team_finish' AND t.root_task_id=$1
      ORDER BY c.created_at DESC`,
    [rootTaskId],
  );
  const completionRun = completionRuns.rows.find(
    (row) => row.status === 'succeeded' && row.has_result_text,
  );
  const hasTeamFinalText = Boolean(teamRunResult.final_text?.trim());
  console.log(
    `completion_evidence: ${JSON.stringify({ source_run_succeeded: Boolean(completionRun), team_final_text: hasTeamFinalText })}`,
  );
  if (!completionRun && !hasTeamFinalText)
    throw new Error('agentic_completion_text_missing');
  const leadTurnReceipts = await db.query(
    `SELECT c.source_run_id,COUNT(*) AS command_count
       FROM team_command_receipts c
       JOIN runs source_run ON source_run.id=c.source_run_id
       JOIN tasks t ON t.id=source_run.task_id
      WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn'
      GROUP BY c.source_run_id`,
    [rootTaskId],
  );
  if (!leadTurnReceipts.rows.some((row) => Number(row.command_count) >= 2))
    throw new Error('lead_did_not_issue_multiple_canonical_commands');
  console.log(
    `lead_multi_command_turn: ${JSON.stringify(leadTurnReceipts.rows.map((row) => ({ command_count: Number(row.command_count) })))}`,
  );
  await request(`/api/v1/team-runs/${teamRunResult.id}`, {
    method: 'GET',
    status: 404,
    authToken: foreignToken,
  });
  const logicalSteps = children.map((t) => t.logical_step_key).filter(Boolean);
  if (new Set(logicalSteps).size !== logicalSteps.length)
    throw new Error('duplicate_logical_step_tasks');
  console.log(`team_member_runtime_sessions: ${linkedMembers.length}`);

  const agenticEvidence = await db.query(
    `SELECT tr.lead_turn_count, COUNT(DISTINCT a.work_item_id) AS work_items, COUNT(*) AS attempts, COUNT(*) FILTER (WHERE a.attempt_no=2) AS rework_attempts, COUNT(*) FILTER (WHERE a.status='completed') AS completed_attempts, COUNT(DISTINCT a.execution_task_id) AS linked_attempt_tasks FROM team_runs tr LEFT JOIN team_work_item_attempts a ON a.team_run_id=tr.id WHERE tr.id=$1 GROUP BY tr.id`,
    [teamRunResult.id],
  );
  const evidence = agenticEvidence.rows[0];
  if (Number(evidence.lead_turn_count) !== 4)
    throw new Error('agentic_lead_turn_count_mismatch');
  if (Number(evidence.work_items) !== 2 || Number(evidence.attempts) !== 3)
    throw new Error('agentic_attempts_missing');
  if (Number(evidence.rework_attempts) !== 1)
    throw new Error('agentic_rework_missing');
  if (Number(evidence.completed_attempts) !== Number(evidence.attempts))
    throw new Error('agentic_attempt_not_completed');
  if (Number(evidence.linked_attempt_tasks) !== Number(evidence.attempts))
    throw new Error('agentic_attempt_task_linkage_missing');
  console.log(`agentic_evidence: ${JSON.stringify(evidence)}`);

  if (stage === 'full') {
    const reworkFeedbackResult = await db.query(
      `SELECT feedback FROM team_work_item_attempts WHERE team_run_id=$1 AND attempt_no=2 LIMIT 1`,
      [teamRunResult.id],
    );
    const reworkFeedback = reworkFeedbackResult.rows[0]?.feedback;
    if (typeof reworkFeedback !== 'string' || !reworkFeedback)
      throw new Error('agentic_rework_feedback_missing');
    bffProject = await pollBffProject(
      rootTaskId,
      teamRunResult.id,
      reworkFeedback
        .replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 64),
    );
    const turnIds = new Set();
    for (const session of bffProject.sessions) {
      if (turnIds.has(session.agent_session_id))
        throw new Error('bff_project_ids_not_distinct');
      turnIds.add(session.agent_session_id);
    }
    for (const session of bffProject.sessions) {
      for (const turn of session.turns) {
        if (turnIds.has(turn.run_id) || turnIds.has(turn.task_id))
          throw new Error('bff_turn_ids_not_distinct');
        turnIds.add(turn.run_id);
        turnIds.add(turn.task_id);
        const replay = await webRequest(
          `/api/team-project/sessions/${session.agent_session_id}/runs/${turn.run_id}/events?task=${rootTaskId}`,
          { method: 'GET', status: 200 },
        );
        if (!replay || !Array.isArray(replay.events))
          throw new Error('bff_event_replay_contract_invalid');
      }
    }
    const turnCount = bffProject.sessions.reduce(
      (count, session) => count + session.turns.length,
      0,
    );
    console.log(
      `bff_project: ${JSON.stringify({ status: bffProject.status, sessions: bffProject.sessions.length, historical_event_replays: turnCount })}`,
    );
  }

  if (retainFile) {
    const temp = `${retainFile}.tmp-${process.pid}`;
    await mkdir(resolve(retainFile, '..'), { recursive: true });
    await writeFile(
      temp,
      `${JSON.stringify({
        status: 'retained-ready',
        root_task_id: rootTaskId,
        team_run_id: teamRunResult.id,
        ...(bffProject
          ? {
              agent_session_ids: bffProject.sessions.map(
                (session) => session.agent_session_id,
              ),
              attempt_task_run_ids: bffProject.sessions.flatMap((session) =>
                session.turns.map((turn) => ({
                  task_id: turn.task_id,
                  run_id: turn.run_id,
                })),
              ),
              web_url: webUrl,
            }
          : {}),
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
        ...(webUrl ? { web_url: webUrl } : {}),
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
      work_items: workItems.length,
      lead_turns: leadTurnTasks.rows.length,
      member_runtime_sessions: linkedMembers.length,
      phases:
        'lead turn -> attempt 1 -> rework -> attempt 2 -> accept -> completion',
      team_run_status: teamRunResult.status,
      ...(bffProject
        ? {
            bff_project: 'passed',
            bff_sessions: bffProject.sessions.length,
            ...(retained ? { web_url: webUrl } : {}),
          }
        : {}),
    }),
  );
} catch (error) {
  if (!(error instanceof FocusedStageComplete)) {
    failure = error;
    throw error;
  }
} finally {
  if (failure) await writeFailureArtifact(true);
  if (retained || process.env.PRESERVE_COLLAB_SMOKE === '1') {
    console.error(`preserved_db: ${dbName}`);
    console.error(`preserved_runtime_root: ${runtimeRoot}`);
    process.exitCode = 1;
  } else {
    await cleanupStep('web_process', () =>
      next ? stopProcessTree(next) : Promise.resolve(),
    );
    await cleanupStep(
      'api_process',
      () =>
        new Promise(
          (resolveClose) =>
            api?.close?.(() => resolveClose()) ?? resolveClose(),
        ),
    );
    await cleanupStep('service', () => service?.close?.());
    await cleanupStep('database_connection', () => db?.end());
    await cleanupStep('database_drop', () =>
      admin?.query(`DROP DATABASE IF EXISTS "${dbName.replaceAll('"', '""')}"`),
    );
    await cleanupStep('admin_connection', () => admin?.end());
    await cleanupStep('paseo_process', () =>
      paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve(),
    );
    await cleanupStep('runtime_root', () =>
      rm(runtimeRoot, { recursive: true, force: true }),
    );
    if (failure) await writeFailureArtifact(false);
  }
}

async function cleanupStep(name, operation) {
  const state = { name, status: 'started', at: new Date().toISOString() };
  cleanupDiagnostics.push(state);
  try {
    await operation();
    state.status = 'succeeded';
  } catch (error) {
    state.status = 'failed';
    state.error_code = safeErrorCode(error);
    failure ??= error;
  }
}

async function writeFailureArtifact(beforeCleanup) {
  if (!retainFile) return;
  if (beforeCleanup) preCleanupArtifactWritten = true;
  if (!failureSnapshot) failureSnapshot = await diagnosticSnapshot();
  const artifact = {
    schema: 'agentic-team-chat/failure-diagnostic-v1',
    status: 'failed',
    stage,
    failure: {
      error_code: safeErrorCode(failure),
      error_name: failure?.constructor?.name === 'Error' ? 'Error' : null,
    },
    identity: {
      root_task_id: uuid(rootTaskId) ? rootTaskId : null,
      db_name: safeDbName(dbName),
    },
    chronology: {
      captured_at: new Date().toISOString(),
      before_destructive_cleanup: beforeCleanup,
      timeline: timeline.map((entry) => ({
        at: entry.at,
        root_status: safeState(entry.root_status),
        latest_run_status: safeState(entry.latest_run_status),
      })),
      states: failureSnapshot,
    },
    cleanup: {
      defaults_preserved: true,
      pre_cleanup_artifact_written: preCleanupArtifactWritten,
      steps: cleanupDiagnostics,
      destructive_cleanup_pending: beforeCleanup,
    },
    log_metadata: {
      captured_console_events: timeline.length,
      raw_logs_retained: false,
      prompts_retained: false,
      provider_payloads_retained: false,
      credentials_retained: false,
    },
  };
  await mkdir(resolve(retainFile, '..'), { recursive: true });
  const temp = `${retainFile}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(artifact)}\n`, { mode: 0o600 });
  await rename(temp, retainFile);
}

async function diagnosticSnapshot() {
  if (!db || !rootTaskId) return { unavailable: true };
  try {
    const focused = await focusedSnapshot(rootTaskId);
    const teamRun = await db.query(
      `SELECT id,status,execution_mode,control_state,revision,lead_turn_count,phase,created_at,updated_at
         FROM team_runs WHERE root_task_id=$1 ORDER BY created_at`,
      [rootTaskId],
    );
    const members = await db.query(
      `SELECT id,name,role,status,runtime_session_id,current_work_item_id,created_at,updated_at
         FROM team_member_runs WHERE team_run_id IN (SELECT id FROM team_runs WHERE root_task_id=$1) ORDER BY created_at`,
      [rootTaskId],
    );
    const work = await db.query(
      `SELECT id,status,owner_member_id,created_by_member_id,execution_task_id,created_at,updated_at,completed_at
         FROM team_work_items WHERE team_run_id IN (SELECT id FROM team_runs WHERE root_task_id=$1) ORDER BY created_at`,
      [rootTaskId],
    );
    const attempts = await db.query(
      `SELECT id,work_item_id,attempt_no,assignee_member_id,execution_task_id,status,created_at,updated_at,completed_at
         FROM team_work_item_attempts WHERE team_run_id IN (SELECT id FROM team_runs WHERE root_task_id=$1) ORDER BY created_at`,
      [rootTaskId],
    );
    const dispatches = await db.query(
      `SELECT d.run_id,d.event_type,d.published_at,d.created_at
         FROM run_dispatches d JOIN runs r ON r.id=d.run_id JOIN tasks t ON t.id=r.task_id
        WHERE t.root_task_id=$1 ORDER BY d.created_at`,
      [rootTaskId],
    );
    return {
      team_runs: teamRun.rows.map(safeStateRow),
      members: members.rows.map(safeStateRow),
      work_items: work.rows.map(safeStateRow),
      attempts: attempts.rows.map(safeStateRow),
      dispatches: dispatches.rows.map(safeStateRow),
      focused,
      grants: focused.mcp_grant_refs,
    };
  } catch (error) {
    return { unavailable: true, error_code: safeErrorCode(error) };
  }
}

function safeStateRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key.endsWith('_at') ? safeTimestamp(value) : safeStateValue(key, value),
    ]),
  );
}

function safeStateValue(key, value) {
  if (key.endsWith('_id') || key === 'id') return uuid(value) ? value : null;
  if (key === 'revision' || key === 'lead_turn_count' || key === 'attempt_no')
    return Number.isFinite(Number(value)) ? Number(value) : null;
  return typeof value === 'string'
    ? safeState(value)
    : value === null
      ? null
      : Boolean(value);
}

function safeTimestamp(value) {
  return value instanceof Date || typeof value === 'string'
    ? new Date(value).toISOString()
    : null;
}

function safeState(value) {
  return typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value)
    ? value
    : null;
}

function safeDbName(value) {
  return typeof value === 'string' &&
    /^agent_server_collab_[0-9a-z_-]+$/u.test(value)
    ? value
    : null;
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message.split(':', 1)[0] : '';
  return safeState(value);
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

async function webRequest(path, options) {
  const response = await fetch(`${webUrl}${path}`, {
    method: options.method,
    headers: {
      origin: webUrl,
      'content-type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status !== options.status)
    throw new Error(`web_http_${response.status}_expected_${options.status}`);
  return body;
}

async function pollBffProject(taskId, expectedTeamRunId, reworkFeedback) {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const project = await webRequest(`/api/team-project?task=${taskId}`, {
      method: 'GET',
      status: 200,
    });
    if (project?.status === 'completed') {
      if (
        project.root_task_id !== taskId ||
        project.team_run_id !== expectedTeamRunId
      )
        throw new Error('bff_project_identity_mismatch');
      assertBffProjectSummary(project);
      const sessions = await Promise.all(
        project.sessions.map(async (summary) => {
          const session = await webRequest(
            `/api/team-project/sessions/${summary.agent_session_id}?task=${taskId}`,
            { method: 'GET', status: 200 },
          );
          if (
            session.agent_session_id !== summary.agent_session_id ||
            session.team_run_id !== expectedTeamRunId ||
            session.read_only !== true ||
            session.name !== summary.name ||
            session.role !== summary.role
          )
            throw new Error('bff_session_identity_invalid');
          return session;
        }),
      );
      const aggregate = { ...project, sessions };
      assertBffProject(aggregate, reworkFeedback);
      return aggregate;
    }
    if (!project || project.status === 'failed')
      throw new Error('bff_project_failed');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error('bff_project_timeout');
}

function assertBffProjectSummary(project) {
  if (project.name !== 'Agentic Team' || project.sessions.length !== 3)
    throw new Error('bff_project_roster_invalid');
  const lead = project.sessions.filter((session) => session.role === 'lead');
  const members = project.sessions.filter(
    (session) => session.role === 'member',
  );
  if (lead.length !== 1 || members.length !== 2)
    throw new Error('bff_project_roles_invalid');
  const sessionIds = project.sessions.map(
    (session) => session.agent_session_id,
  );
  if (new Set(sessionIds).size !== sessionIds.length)
    throw new Error('bff_session_ids_not_distinct');
  for (const session of project.sessions)
    if (!uuid(session.agent_session_id))
      throw new Error('bff_session_id_invalid');
}

function assertBffProject(project, reworkFeedback) {
  assertBffProjectSummary(project);
  const lead = project.sessions.filter((session) => session.role === 'lead');
  const members = project.sessions.filter(
    (session) => session.role === 'member',
  );
  const leadSession = lead[0];
  const memberTurns = members.map((session) => session.turns);
  if (
    memberTurns.filter((turns) => turns.length === 2).length !== 1 ||
    memberTurns.filter((turns) => turns.length === 1).length !== 1 ||
    leadSession.turns.length !== 4
  )
    throw new Error('bff_project_turn_counts_invalid');
  for (const session of project.sessions) {
    for (const turn of session.turns) {
      if (!uuid(turn.task_id) || !uuid(turn.run_id))
        throw new Error('bff_turn_id_invalid');
    }
    for (let i = 1; i < session.turns.length; i++)
      if (session.turns[i - 1].sequence >= session.turns[i].sequence)
        throw new Error('bff_project_turn_order_invalid');
  }
  const reworked = memberTurns.find((turns) => turns.length === 2);
  if (!reworked?.[1].context || !reworked[1].context.includes(reworkFeedback))
    throw new Error('bff_project_rework_context_missing');
}

function onlyKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key)) &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function uuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validatedPort(value) {
  if (!/^[0-9]+$/.test(value)) throw new Error('invalid_agentic_team_web_port');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('invalid_agentic_team_web_port');
  return port;
}

async function poll(taskId) {
  const deadline =
    Date.now() + Number(process.env.COLLAB_SMOKE_POLL_MS ?? 180_000);
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
      await retainFocusedState(lastSnapshot);
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
  await retainFocusedState(lastSnapshot ?? (await focusedSnapshot(taskId)));
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
            t.team_member_run_id,r.id AS run_id,r.status AS run_status,r.lease_expires_at,
            r.error->>'code' AS run_error_code,
            rs.id AS runtime_session_id,rs.provider_agent_id,
            av.canonical_package->'spec'->'tools' AS agent_tool_refs,
            sls.tool_refs AS session_tool_refs
       FROM tasks t LEFT JOIN runs r ON r.task_id=t.id
       LEFT JOIN runtime_sessions rs ON rs.task_id=t.id
       LEFT JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
       LEFT JOIN agent_versions av ON av.id::text=t.invokable_version_id
      WHERE t.root_task_id=$1 ORDER BY t.created_at`,
    [taskId],
  );
  const runIds = tasks.rows.map((row) => row.run_id).filter(Boolean);
  const receipts = teamRun
    ? await db.query(
        `SELECT command_name,created_at FROM team_command_receipts
          WHERE source_run_id IN (SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id
                                   WHERE t.root_task_id=$1)
          ORDER BY created_at`,
        [taskId],
      )
    : { rows: [] };
  const receiptsByRun = new Map();
  if (runIds.length) {
    const runReceipts = await db.query(
      `SELECT source_run_id,command_name,created_at
         FROM team_command_receipts
        WHERE source_run_id = ANY($1::uuid[])
        ORDER BY created_at DESC`,
      [runIds],
    );
    for (const receipt of runReceipts.rows) {
      const existing = receiptsByRun.get(receipt.source_run_id) ?? [];
      existing.push(receipt);
      receiptsByRun.set(receipt.source_run_id, existing);
    }
  }
  const attempts = teamRun
    ? await db.query(
        `SELECT attempt_no,status,execution_task_id,result_summary
           FROM team_work_item_attempts WHERE team_run_id=$1 ORDER BY attempt_no`,
        [teamRun.id],
      )
    : { rows: [] };
  const leadRun = tasks.rows.find(
    (row) => row.team_task_kind === 'lead_turn' && row.run_id,
  );
  const events = leadRun
    ? await db.query(
        `SELECT sequence,type,created_at,payload
           FROM run_events WHERE run_id=$1 ORDER BY sequence DESC LIMIT 10`,
        [leadRun.run_id],
      )
    : { rows: [] };
  const grantRefs = await readGrantRefs();
  const permissionEvents = runIds.length
    ? await db.query(
        `SELECT run_id,sequence,type,created_at,payload
           FROM (
             SELECT run_id,sequence,type,created_at,payload,
                    ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY sequence DESC) AS permission_rank
               FROM run_events
              WHERE run_id = ANY($1::uuid[]) AND payload->>'kind'='permission'
           ) permission_events
          WHERE permission_rank <= $2
          ORDER BY run_id,sequence DESC`,
        [runIds, MAX_PERMISSION_EVENTS_PER_RUN],
      )
    : { rows: [] };
  const permissionEventsByRun = new Map();
  for (const event of permissionEvents.rows) {
    const existing = permissionEventsByRun.get(event.run_id) ?? [];
    existing.push(safeRunEvent(event));
    permissionEventsByRun.set(event.run_id, existing);
  }
  const childEvents = runIds.length
    ? await db.query(
        `SELECT run_id,sequence,type,created_at,payload
           FROM run_events WHERE run_id = ANY($1::uuid[])
          ORDER BY created_at DESC`,
        [runIds],
      )
    : { rows: [] };
  const eventsByRun = new Map();
  for (const event of childEvents.rows) {
    const existing = eventsByRun.get(event.run_id) ?? [];
    if (existing.length < 10) existing.push(safeRunEvent(event));
    eventsByRun.set(event.run_id, existing);
  }
  const safeTasks = tasks.rows.map((row) => ({
    task_id: row.id,
    kind: row.team_task_kind,
    logical_step: row.logical_step_key,
    task_status: row.task_status,
    run_id: row.run_id,
    run_status: row.run_status,
    run_error_code: safeEnum(row.run_error_code, SAFE_ERROR_CODES),
    member_id: row.team_member_run_id,
    last_10_events: mergeSafeRunEvents(
      eventsByRun.get(row.run_id) ?? [],
      permissionEventsByRun.get(row.run_id) ?? [],
    ),
    ...(row.team_task_kind === 'lead_turn' && row.run_id
      ? {
          command_receipts: safeCommandReceipts(
            receiptsByRun.get(row.run_id) ?? [],
          ),
        }
      : {}),
    runtime_session: row.runtime_session_id
      ? {
          exists: true,
          id: row.runtime_session_id,
          provider_agent_id: row.provider_agent_id,
        }
      : { exists: false },
    effective_agent_tool_refs: safeToolRefs(row.agent_tool_refs),
    session_tool_refs: safeToolRefs(row.session_tool_refs),
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
    receipt_names: receipts.rows
      .map((row) => safeEnum(row.command_name, AGENTIC_COMMAND_RECEIPTS))
      .filter(Boolean),
    lead_run: leadRun
      ? {
          status: leadRun.run_status,
          last_10_events: events.rows.reverse().map(safeRunEvent),
        }
      : null,
    mcp_grant_refs: grantRefs,
    attempts: attempts.rows.map((row) => ({
      attempt_no: Number(row.attempt_no),
      status: row.status,
      materialized: row.execution_task_id !== null,
      has_result: Boolean(row.result_summary),
      linked_run_status:
        safeTasks.find((task) => task.task_id === row.execution_task_id)
          ?.run_status ?? null,
      linked_run_error_code:
        safeTasks.find((task) => task.task_id === row.execution_task_id)
          ?.run_error_code ?? null,
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

async function retainFocusedState(snapshot) {
  if (!retainFile) return;
  await mkdir(resolve(retainFile, '..'), { recursive: true });
  const temp = `${retainFile}.tmp-${process.pid}`;
  await writeFile(
    temp,
    `${JSON.stringify({
      status: 'retained-ready',
      stage,
      root_task_id: rootTaskId,
      db_name: dbName,
      api_url: apiUrl,
      runtime_root: '<runtime-root>',
      snapshot,
      timeline,
    })}\n`,
    { mode: 0o600 },
  );
  await rename(temp, retainFile);
  retained = true;
  console.log(
    JSON.stringify({
      status: 'retained-ready',
      stage,
      root_task_id: rootTaskId,
    }),
  );
}

function safeRunEvent(event) {
  const payload = event.payload ?? {};
  const isPermission = payload.kind === 'permission';
  return {
    sequence: safeSequence(event.sequence),
    type: safeEnum(event.type, SAFE_RUN_EVENT_TYPES),
    tool: safeEnum(payload.tool_name, SAFE_TOOL_NAMES),
    status: safeState(payload.status),
    detail_kind: safeEnum(payload.detail_kind, SAFE_DETAIL_KINDS),
    permission_category: isPermission
      ? safeEnum(payload.category, SAFE_PERMISSION_KINDS)
      : null,
    permission_status: isPermission
      ? safeEnum(payload.status, SAFE_PERMISSION_STATUSES)
      : null,
    permission_decision: isPermission
      ? safeEnum(payload.decision, SAFE_PERMISSION_DECISIONS)
      : null,
    permission_summary: isPermission
      ? safePermissionSummary(payload.summary)
      : null,
    label: safeLabel(payload.label),
    at: event.created_at,
  };
}

function mergeSafeRunEvents(general, permissions) {
  const byKey = new Map();
  for (const event of [...general, ...permissions]) {
    const key = `${event.sequence ?? 'unknown'}:${event.at ?? 'unknown'}`;
    byKey.set(key, event);
  }
  return [...byKey.values()].sort((left, right) => {
    const sequenceDelta = (right.sequence ?? 0) - (left.sequence ?? 0);
    return (
      sequenceDelta ||
      String(right.at ?? '').localeCompare(String(left.at ?? ''))
    );
  });
}

function safeSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

function safePermissionSummary(value) {
  return typeof value === 'string' && SAFE_PERMISSION_SUMMARIES.has(value)
    ? value
    : null;
}

function safeCommandReceipts(receipts) {
  return {
    exists: receipts.length > 0,
    names: receipts
      .map((receipt) =>
        safeEnum(receipt.command_name, AGENTIC_COMMAND_RECEIPTS),
      )
      .filter(Boolean),
    latest_at: receipts[0]?.created_at ?? null,
  };
}

function safeEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function safeLabel(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/u.test(value)
  )
    return null;
  return value;
}

function safeToolRefs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === 'string'
        ? entry
        : typeof entry?.ref === 'string'
          ? entry.ref
          : null,
    )
    .filter((ref) => /^agent-server\/[a-z0-9-]+$/u.test(ref));
}

function safeString(value) {
  return typeof value === 'string' ? value : null;
}

async function readGrantRefs() {
  const refs = [];
  try {
    const cells = await readdir(cellRoot, { withFileTypes: true });
    for (const cell of cells.filter((entry) => entry.isDirectory())) {
      const grants = join(cellRoot, cell.name, 'skill-receipts', 'grants');
      for (const file of await readdir(grants).catch(() => [])) {
        if (!file.endsWith('.json')) continue;
        const receipt = JSON.parse(await readFile(join(grants, file), 'utf8'));
        refs.push({
          grant_id: uuid(receipt.grantId) ? receipt.grantId : null,
          allowed_tools: safeToolRefs(receipt.allowedTools),
        });
      }
    }
  } catch {
    return [];
  }
  return refs;
}

function focusedStageSatisfied(requestedStage, snapshot) {
  const receipts = new Set(snapshot.receipt_names);
  const attempts = snapshot.attempts;
  if (requestedStage === 'lead_command')
    return Boolean(
      snapshot.team_run?.execution_mode === 'agentic_mve' &&
      snapshot.tasks_runs.some((row) => row.kind === 'lead_turn') &&
      snapshot.tasks_runs.some(
        (row) => row.kind === 'lead_turn' && row.run_status === 'succeeded',
      ) &&
      [...receipts].some((name) => AGENTIC_COMMAND_RECEIPTS.has(name)),
    );
  if (requestedStage === 'attempt1_materialized')
    return attempts.some((row) => row.attempt_no === 1 && row.materialized);
  if (requestedStage === 'attempt1_terminal')
    return attempts.some(
      (row) =>
        row.attempt_no === 1 && row.status === 'completed' && row.has_result,
    );
  if (requestedStage === 'rework_command')
    return receipts.has('team_work_request_changes');
  if (requestedStage === 'attempt2_terminal')
    return attempts.some(
      (row) =>
        row.attempt_no === 2 && row.status === 'completed' && row.has_result,
    );
  if (requestedStage === 'completion')
    return (
      receipts.has('team_finish') || snapshot.team_run?.status === 'succeeded'
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
  const teamTools =
    name === 'lead'
      ? '    - ref: agent-server/team-state\n      kind: tool\n    - ref: agent-server/team-work-list\n      kind: tool\n    - ref: agent-server/team-work-create\n      kind: tool\n    - ref: agent-server/team-work-request-changes\n      kind: tool\n    - ref: agent-server/team-work-accept-v2\n      kind: tool\n    - ref: agent-server/team-finish\n      kind: tool'
      : '    - ref: agent-server/team-state\n      kind: tool\n    - ref: agent-server/team-work-list\n      kind: tool\n    - ref: agent-server/team-work-checkpoint\n      kind: tool\n    - ref: agent-server/team-work-submit\n      kind: tool';
  const instructions =
    name === 'lead'
      ? 'Act directly as the Lead using only your canonical Lead Team tools: team-state, team-work-list, team-work-create, team-work-request-changes, team-work-accept-v2, and team-finish. Do not spawn or delegate to subagents in a Lead control turn, and never call member-only team_work_checkpoint or team_work_submit. In turn 1 immediately issue multiple commands: create exactly one Work item for analyst and exactly one for verifier, then return a short decision text. On review, require both a market snapshot and event evidence: request changes exactly once for the analyst Attempt 1 that lacks event evidence, and accept the qualifying verifier Work in the same turn. On the next turn accept the corrected analyst Attempt 2 only after both evidence categories are present, then finish. Never wait for running members or repeat a successful Team mutation.'
      : name === 'analyst'
        ? 'Act as the outer Team member using only canonical Team tools and the named synthetic tools. You may delegate bounded domain research to subagents; descendants share your Team identity and MCP context and should return findings to you without repeating Team mutations. You must aggregate their findings and perform the canonical protocol yourself. For Attempt 1, obtain synthetic_stock_snapshot evidence exactly once and intentionally do not obtain synthetic_event_batch evidence; then call team_work_checkpoint exactly once and team_work_submit exactly once for the same Work. After Lead requests changes, for Attempt 2 obtain synthetic_stock_snapshot evidence exactly once and synthetic_event_batch evidence exactly once; then call team_work_checkpoint exactly once and team_work_submit exactly once. After a successful descendant or parent submit, stop all Team mutations. No domain output, plain text, or idle state completes Work: completion occurs only through canonical team_work_submit. Include ACME, data_as_of 2026-07-31, uncertainty and risk, and no investment advice.'
        : 'Act as the outer Team member using only canonical Team tools and the named synthetic tools. You may delegate bounded domain research to subagents; descendants share your Team identity and MCP context and should return findings to you without repeating Team mutations. You must aggregate their findings, obtain synthetic_stock_snapshot evidence exactly once and synthetic_event_batch evidence exactly once, then call team_work_checkpoint exactly once and team_work_submit exactly once for the same Work. After a successful descendant or parent submit, stop all Team mutations. No domain output, plain text, or idle state completes Work: completion occurs only through canonical team_work_submit. Include ACME, data_as_of 2026-07-31, uncertainty and risk, and no investment advice.';
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: collab-smoke-${name}\nspec:\n  description: Collaborative team smoke ${displayName}\n  instructions: ${JSON.stringify(
    instructions,
  )}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${teamTools}\n    - ref: agent-server/synthetic-stock-snapshot\n      kind: tool\n    - ref: agent-server/synthetic-event-batch\n      kind: tool\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute your assigned role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: collab-team-smoke\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}

function teamYaml(leadAgentId, analystAgentId, verifierAgentId, envVersionId) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: collab-research-team\nspec:\n  environmentVersionId: ${envVersionId}\n  lead:\n    name: lead\n    agentVersionId: ${leadAgentId}\n  roster:\n    - name: analyst\n      agentVersionId: ${analystAgentId}\n    - name: verifier\n      agentVersionId: ${verifierAgentId}\n  coordination:\n    mode: agentic_mve\n    taskAssignment: lead_or_self_claim\n`;
}
