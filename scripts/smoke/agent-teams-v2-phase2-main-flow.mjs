import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register as registerTsx } from 'tsx/esm/api';

registerTsx();

import { serve } from '@hono/node-server';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client as PostgresClient } from 'pg';

import { getAvailablePort, waitForHttp } from '../dev/paseo-process.mjs';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const outerTimeoutSeconds = Number(
  process.env.PHASE2_EVIDENCE_OUTER_TIMEOUT_SECONDS ?? '0',
);
const startedAt = Date.now();
const suffix = randomUUID().slice(0, 8);
const databaseName = `agent_server_phase2_server_${startedAt}_${suffix}`;
const evidenceName = `phase2-server-${startedAt}-${suffix}`;
const evidenceRoot = join(repositoryRoot, '.local', evidenceName);
const runtimeRoot = join(
  repositoryRoot,
  '.local',
  `phase2-server-runtime-${startedAt}-${suffix}`,
);
const projectCwd = join(runtimeRoot, 'project');
const cellRoot = join(runtimeRoot, 'cells');
const registryRoot = join(runtimeRoot, 'skills');
const manifestPath = join(evidenceRoot, 'manifest.json');
const stdoutPath = join(evidenceRoot, 'stdout.ndjson');
const stderrPath = join(evidenceRoot, 'stderr.ndjson');
const token = `phase2-server-${randomUUID()}`;
const tenantId = 'tenant_phase2_server';
const principalId = 'svc_phase2_server';
const workspaceId = randomUUID();
const ids = { workspace_id: workspaceId };
const markers = [];
const stdout = [];
const stderr = [];
const runtimeCalls = [];
let admin;
let db;
let service;
let api;
let apiUrl;
let rootTaskId;
let replayBefore;
let replayAfter;
let acceptControl;
let finishControl;

await mkdir(evidenceRoot, { recursive: true });
await mkdir(projectCwd, { recursive: true });
await mkdir(cellRoot, { recursive: true });
await mkdir(registryRoot, { recursive: true });
await chmod(evidenceRoot, 0o700);

function assertion(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safe(value) {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /^(?:authorization|token|secret|password|api.?key|prompt|systemPrompt|body|content)$/iu.test(
          key,
        )
          ? '[redacted]'
          : safe(entry),
      ]),
    );
  if (typeof value !== 'string') return value;
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\/(?:Users|Volumes)\/[^\s"]+/gu, '[path]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 2048);
}

function marker(name, fields = {}) {
  const entry = safe({
    marker: name,
    at: new Date().toISOString(),
    database_name: databaseName,
    ids,
    ...fields,
  });
  markers.push(entry);
  const line = JSON.stringify(entry);
  stdout.push(line);
  process.stdout.write(`${line}\n`);
}

async function atomicJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(safe(value), null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temp, path);
  await chmod(path, 0o600);
}

async function writeEvidence(result, error) {
  if (error) {
    const line = JSON.stringify(
      safe({ error: error instanceof Error ? error.message : 'unknown_error' }),
    );
    stderr.push(line);
    process.stderr.write(`${line}\n`);
  }
  const manifest = {
    schema: 'agent-teams-v2-phase2-real-server-v1',
    result,
    database_name: databaseName,
    evidence_name: evidenceName,
    node_version: process.version,
    execution: {
      outer_timeout_seconds: outerTimeoutSeconds,
      command: `AGENTIC_TEAM_SMOKE_STAGE=phase2_durable_wake PHASE2_EVIDENCE_OUTER_TIMEOUT_SECONDS=${outerTimeoutSeconds} timeout ${outerTimeoutSeconds}s node --import tsx scripts/smoke/agentic-team-chat-main-flow.mjs`,
      expected_exit_code: 0,
      process_exit_code: result === 'passed' ? 0 : 1,
      elapsed_ms: Date.now() - startedAt,
    },
    composition: {
      create_service: true,
      tcp_http_server: true,
      canonical_api_setup_and_invoke: true,
      runtime_mcp_http: true,
      postgres_run_dispatcher: true,
      provider_used: false,
      paseo_used: false,
      deterministic_substitution_scope:
        'provider_runtime_driver_and_model_decisions',
    },
    ids,
    markers,
    runtime_calls: runtimeCalls,
    stdout_file: 'stdout.ndjson',
    stderr_file: 'stderr.ndjson',
    credentials: '[absent]',
    prompts: '[absent]',
  };
  await writeFile(stdoutPath, `${stdout.join('\n')}\n`, { mode: 0o600 });
  await writeFile(stderrPath, stderr.length ? `${stderr.join('\n')}\n` : '', {
    mode: 0o600,
  });
  await atomicJson(manifestPath, manifest);
  await Promise.all([chmod(stdoutPath, 0o600), chmod(stderrPath, 0o600)]);
}

function toolValue(result) {
  const value = result?.structuredContent ?? null;
  assertion(value && typeof value === 'object', 'mcp_result_missing');
  assertion(!value.error, `mcp_tool_error_${value.error ?? 'unknown'}`);
  return value;
}

class DeterministicRuntime {
  #sessions = new Map();
  #leadTurns = 0;
  #memberTurns = 0;

  async initialize() {}

  async health() {
    return {
      ready: true,
      provider: 'deterministic-smoke',
      model: 'scripted-decisions',
      checks: [{ name: 'deterministic_smoke', ready: true }],
    };
  }

  async execute(input) {
    let session;
    let providerAgentId;
    if (input.operation === 'create') {
      const server = input.extensions?.mcpServers?.[0];
      assertion(server?.url, 'runtime_mcp_url_missing');
      assertion(
        typeof server.headers?.Authorization === 'string',
        'runtime_mcp_authorization_missing',
      );
      const client = new McpClient({
        name: 'phase2-deterministic-runtime',
        version: '1.0.0',
      });
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      });
      await client.connect(transport);
      providerAgentId = `deterministic-${randomUUID()}`;
      session = { client, transport };
      this.#sessions.set(providerAgentId, session);
    } else {
      providerAgentId = input.providerAgentId;
      session = this.#sessions.get(providerAgentId);
      assertion(session, 'deterministic_runtime_session_missing');
    }
    const tools = await session.client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    if (names.has('team_work_create')) {
      this.#leadTurns += 1;
      if (this.#leadTurns === 1) {
        const result = toolValue(
          await session.client.callTool({
            name: 'team_work_create',
            arguments: {
              subject: 'Durable wake proof',
              description: 'Complete the retained Phase 2 real-server proof.',
              assignee: 'member',
            },
          }),
        );
        runtimeCalls.push({
          role: 'lead',
          turn: 1,
          tool: 'team_work_create',
          result_hash: sha256(JSON.stringify(result)),
        });
      } else if (this.#leadTurns === 2) {
        const argumentsValue = {
          work_ref: 'work-1',
          assignee: 'member',
          feedback: 'Provide the corrected bounded result.',
        };
        const first = toolValue(
          await session.client.callTool({
            name: 'team_work_request_changes',
            arguments: argumentsValue,
          }),
        );
        replayBefore = await attemptMessage(2);
        const replay = toolValue(
          await session.client.callTool({
            name: 'team_work_request_changes',
            arguments: argumentsValue,
          }),
        );
        replayAfter = await attemptMessage(2);
        runtimeCalls.push({
          role: 'lead',
          turn: 2,
          tool: 'team_work_request_changes',
          first_result_hash: sha256(JSON.stringify(first)),
          replay_result_hash: sha256(JSON.stringify(replay)),
          replay_same_result: JSON.stringify(first) === JSON.stringify(replay),
        });
      } else if (this.#leadTurns === 3) {
        const accepted = toolValue(
          await session.client.callTool({
            name: 'team_work_accept',
            arguments: { work_ref: 'work-1' },
          }),
        );
        acceptControl = await teamControl();
        runtimeCalls.push({
          role: 'lead',
          turn: this.#leadTurns,
          tool: 'team_work_accept',
          result_hash: sha256(JSON.stringify(accepted)),
        });
      } else {
        const finished = toolValue(
          await session.client.callTool({
            name: 'team_finish',
            arguments: {},
          }),
        );
        finishControl = await teamControl();
        runtimeCalls.push({
          role: 'lead',
          turn: this.#leadTurns,
          tool: 'team_finish',
          result_hash: sha256(JSON.stringify(finished)),
        });
      }
    } else {
      assertion(names.has('team_work_submit'), 'member_submit_tool_missing');
      this.#memberTurns += 1;
      const summary = `Deterministic attempt ${this.#memberTurns} result.`;
      toolValue(
        await session.client.callTool({
          name: 'team_work_checkpoint',
          arguments: { summary },
        }),
      );
      const submitted = toolValue(
        await session.client.callTool({
          name: 'team_work_submit',
          arguments: { summary },
        }),
      );
      runtimeCalls.push({
        role: 'member',
        turn: this.#memberTurns,
        tools: ['team_work_checkpoint', 'team_work_submit'],
        result_hash: sha256(JSON.stringify(submitted)),
      });
    }
    return {
      provider: 'deterministic-smoke',
      model: 'scripted-decisions',
      providerAgentId,
      text: `Deterministic ${names.has('team_work_create') ? 'Lead' : 'member'} turn completed.`,
      usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0 },
    };
  }

  async close() {
    for (const session of this.#sessions.values())
      await session.client.close().catch(() => undefined);
    this.#sessions.clear();
  }
}

async function request(path, options) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': options.idempotencyKey ?? randomUUID(),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== options.status) {
    const code =
      typeof body?.error?.code === 'string' ? body.error.code : 'unknown';
    throw new Error(
      `http_${response.status}_expected_${options.status}_${code}`,
    );
  }
  return body;
}

async function queuedRun(kind) {
  const result = await db.query(
    `SELECT r.id
       FROM runs r
       JOIN tasks t ON t.id=r.task_id
       JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue'
      WHERE t.root_task_id=$1 AND r.status='queued' AND d.published_at IS NULL
        AND ($2::text IS NULL OR t.team_task_kind=$2)
      ORDER BY d.id
      LIMIT 1`,
    [rootTaskId, kind ?? null],
  );
  assertion(result.rows.length === 1, `queued_${kind ?? 'root'}_run_missing`);
  return result.rows[0].id;
}

async function attemptMessage(attemptNo) {
  const result = await db.query(
    `SELECT m.id,m.team_run_id,m.sender_member_run_id,m.recipient_member_run_id,
            m.kind,m.dedup_key,m.body,m.status,m.consumed_by_task_id,m.attempt_id
       FROM team_messages m
       JOIN team_work_item_attempts a ON a.id=m.attempt_id
      WHERE a.team_run_id=$1 AND a.attempt_no=$2`,
    [ids.team_run_id, attemptNo],
  );
  assertion(result.rows.length === 1, `attempt_${attemptNo}_message_invalid`);
  const row = result.rows[0];
  return {
    ...row,
    body_hash: sha256(row.body),
    body_length: row.body.length,
    body: undefined,
  };
}

async function exactState(messageId) {
  const result = await db.query(
    `SELECT m.id AS message_id,m.status AS message_status,m.consumed_by_task_id,
            m.sender_member_run_id,m.recipient_member_run_id,m.kind,m.dedup_key,
            t.id AS task_id,t.status AS task_status,t.source_team_message_id,
            t.input_team_message_ids,input_message.id AS source_message_id,
            r.id AS run_id,
            r.status AS run_status,d.id::text AS dispatch_id,d.published_at
       FROM team_messages m
       LEFT JOIN tasks t ON t.source_team_message_id=m.id
       LEFT JOIN runs r ON r.task_id=t.id
       LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue'
       LEFT JOIN LATERAL (
         SELECT product_message.id
           FROM messages product_message
          WHERE product_message.task_id=t.id AND product_message.role='user'
          ORDER BY product_message.sequence,product_message.created_at,product_message.id
          LIMIT 1
       ) AS input_message ON TRUE
      WHERE m.id=$1`,
    [messageId],
  );
  assertion(result.rows.length === 1, 'exact_state_cardinality_invalid');
  const row = result.rows[0];
  const counts = await db.query(
    `SELECT
       (SELECT count(*)::int FROM team_messages WHERE id=$1) AS messages,
       (SELECT count(*)::int FROM tasks WHERE source_team_message_id=$1) AS tasks,
       (SELECT count(*)::int FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.source_team_message_id=$1) AS runs,
       (SELECT count(*)::int FROM run_dispatches d JOIN runs r ON r.id=d.run_id JOIN tasks t ON t.id=r.task_id WHERE t.source_team_message_id=$1 AND d.event_type='run.enqueue') AS dispatches`,
    [messageId],
  );
  return {
    ...row,
    published_at: undefined,
    dispatch_published: row.published_at !== null,
    counts: counts.rows[0],
  };
}

async function teamControl() {
  const result = await db.query(
    `SELECT status,phase,control_state,revision,lead_turn_count,
            completion_requested_by_run_id
       FROM team_runs WHERE id=$1`,
    [ids.team_run_id],
  );
  assertion(result.rows.length === 1, 'team_control_state_missing');
  return result.rows[0];
}

async function waitFor(load, accept, code, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await load();
    if (accept(last)) return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`${code}:${JSON.stringify(safe(last))}`);
}

function agentYaml(name) {
  const lead = name === 'lead';
  const tools = lead
    ? [
        'agent-server/team-state',
        'agent-server/team-work-list',
        'agent-server/team-work-create',
        'agent-server/team-work-request-changes',
        'agent-server/team-work-accept-v2',
        'agent-server/team-finish',
      ]
    : [
        'agent-server/team-state',
        'agent-server/team-work-list',
        'agent-server/team-work-checkpoint',
        'agent-server/team-work-submit',
      ];
  const toolYaml = tools
    .map((ref) => `    - ref: ${ref}\n      kind: tool`)
    .join('\n');
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: phase2-${name}\nspec:\n  description: Phase 2 ${name}\n  instructions: ${JSON.stringify(lead ? 'Coordinate one bounded work item.' : 'Submit the assigned bounded work.')}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${toolYaml}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute the bounded role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: phase2-server\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}

function teamYaml(leadAgentId, memberAgentId, environmentVersionId) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: phase2-server-team\nspec:\n  environmentVersionId: ${environmentVersionId}\n  lead:\n    name: lead\n    agentVersionId: ${leadAgentId}\n  roster:\n    - name: member\n      agentVersionId: ${memberAgentId}\n    - name: observer\n      agentVersionId: ${memberAgentId}\n  coordination:\n    mode: agentic_mve\n    taskAssignment: lead_or_self_claim\n`;
}

try {
  assertion(
    Number.isInteger(outerTimeoutSeconds) && outerTimeoutSeconds >= 1,
    'missing_or_invalid_outer_timeout',
  );
  assertion(adminUrl, 'missing_POSTGRES_ADMIN_URL');
  admin = new PostgresClient({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  db = new PostgresClient({ connectionString: databaseUrl.toString() });
  await db.connect();

  const apiPort = await getAvailablePort();
  process.env.NODE_ENV = 'test';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(apiPort);
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.POSTGRES_URL = databaseUrl.toString();
  process.env.PASEO_WS_URL = 'ws://127.0.0.1:1';
  process.env.PASEO_AGENT_CWD = projectCwd;
  process.env.PASEO_RUNTIME_CELL_ROOT = cellRoot;
  process.env.AGENT_SERVER_SKILL_REGISTRY_ROOT = registryRoot;
  process.env.SERVICE_ACCOUNTS_JSON = JSON.stringify([
    {
      serviceAccountId: principalId,
      token,
      tenantId,
      workspaceId,
      policyVersion: 'phase2-server-v1',
    },
  ]);
  const { loadConfig } = await import('../../src/shared/config.ts');
  const { createLogger } =
    await import('../../src/shared/observability/logger.ts');
  const { createService } = await import('../../src/bootstrap.ts');
  const runtime = new DeterministicRuntime();
  const config = loadConfig();
  service = await createService(
    config,
    createLogger({
      service: 'phase2-real-server-evidence',
      minimumLevel: 'error',
      write: () => undefined,
    }),
    {
      singleRunDebug: true,
      debugRuntime: runtime,
      deferTeamWakeReconcile: true,
    },
  );
  await service.runtime.initialize();
  api = serve({
    fetch: service.app.fetch,
    hostname: '127.0.0.1',
    port: apiPort,
  });
  apiUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(`${apiUrl}/health/ready`, 10_000);
  marker('REAL_SERVER_READY', {
    expected: { create_service: true, tcp_http: true, ready: true },
    actual: { create_service: true, tcp_http: true, ready: true },
  });

  await db.query(
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',
    [workspaceId, tenantId, 'service_account', principalId, 'Phase 2 Server'],
  );
  const agents = {};
  for (const name of ['lead', 'member']) {
    const imported = await request('/api/v1/agents:import', {
      method: 'POST',
      body: { source: agentYaml(name) },
      status: 201,
    });
    await request(`/api/v1/agent-versions/${imported.version.id}:publish`, {
      method: 'POST',
      body: {},
      status: 200,
    });
    agents[name] = imported.version.id;
  }
  const environment = await request('/api/v1/environments:import', {
    method: 'POST',
    body: { source: environmentYaml() },
    status: 201,
  });
  await request(
    `/api/v1/environment-versions/${environment.version.id}:publish`,
    { method: 'POST', body: {}, status: 200 },
  );
  const importedTeam = await request('/api/v1/teams:import', {
    method: 'POST',
    body: {
      source: teamYaml(agents.lead, agents.member, environment.version.id),
    },
    status: 201,
  });
  const publishedTeam = await request(
    `/api/v1/team-versions/${importedTeam.version.id}:publish`,
    { method: 'POST', body: {}, status: 200 },
  );
  const invoked = await request('/api/v1/tasks:invoke', {
    method: 'POST',
    body: {
      invokable: { kind: 'team', version_id: publishedTeam.id },
      input: { text: 'Complete one bounded retained durable-wake proof.' },
    },
    status: 202,
  });
  rootTaskId = invoked.task_id;
  ids.root_task_id = rootTaskId;
  ids.team_version_id = publishedTeam.id;
  marker('CANONICAL_API_INVOKED', {
    expected: { http_setup: true, http_invoke: true },
    actual: { http_setup: true, http_invoke: true, root_task_id: rootTaskId },
  });

  const rootRunId = await queuedRun(null);
  ids.root_run_id = rootRunId;
  const rootResult = await service.singleRunDebug.claimAndExecute(rootRunId);
  assertion(rootResult.claimed, 'root_run_not_claimed');
  const team = await db.query(
    'SELECT id FROM team_runs WHERE root_task_id=$1',
    [rootTaskId],
  );
  assertion(team.rows.length === 1, 'team_run_missing');
  ids.team_run_id = team.rows[0].id;
  const roster = await db.query(
    'SELECT id,name,role FROM team_member_runs WHERE team_run_id=$1 ORDER BY role,name',
    [ids.team_run_id],
  );
  const lead = roster.rows.find((row) => row.role === 'lead');
  const member = roster.rows.find((row) => row.role === 'member');
  assertion(lead && member, 'team_roster_invalid');
  ids.lead_member_id = lead.id;
  ids.member_id = member.id;

  const lead1RunId = await queuedRun('lead_turn');
  ids.lead1_run_id = lead1RunId;
  const lead1Result = await service.singleRunDebug.claimAndExecute(lead1RunId);
  assertion(lead1Result.terminalStatus === 'succeeded', 'lead1_not_succeeded');
  const message1 = await attemptMessage(1);
  const assignmentControl = await teamControl();
  ids.message1_id = message1.id;
  assertion(message1.status === 'queued', 'message1_not_queued');
  assertion(
    message1.sender_member_run_id === lead.id,
    'message1_sender_invalid',
  );
  assertion(
    message1.recipient_member_run_id === member.id,
    'message1_recipient_invalid',
  );
  assertion(message1.kind === 'wake', 'message1_kind_invalid');
  assertion(
    assignmentControl.control_state === 'member_work_running',
    'assignment_control_state_invalid',
  );
  const firstReconcile = await service.singleRunDebug.rebuildQueuedTeamWakes();
  const firstReplay = await service.singleRunDebug.rebuildQueuedTeamWakes();
  assertion(
    firstReconcile === 1 && firstReplay === 0,
    'message1_reconcile_invalid',
  );
  const message1Bound = await exactState(message1.id);
  ids.attempt1_task_id = message1Bound.task_id;
  ids.attempt1_run_id = message1Bound.run_id;
  assertion(
    message1Bound.message_status === 'consumed' &&
      message1Bound.task_status === 'queued' &&
      message1Bound.run_status === 'queued',
    'message1_binding_invalid',
  );
  marker('ATTEMPT1_DURABLE_WAKE_BOUND', {
    pre: {
      message_status: message1.status,
      sender_member_run_id: message1.sender_member_run_id,
      recipient_member_run_id: message1.recipient_member_run_id,
      kind: message1.kind,
      dedup_key: message1.dedup_key,
      body_hash: message1.body_hash,
      body_length: message1.body_length,
      control_state: assignmentControl.control_state,
    },
    expected: { first_reconcile: 1, second_reconcile: 0 },
    actual: {
      first_reconcile: firstReconcile,
      second_reconcile: firstReplay,
      state: message1Bound,
    },
  });

  service.singleRunDebug.startDispatcher();
  const message2 = await waitFor(
    () => attemptMessage(2).catch(() => null),
    (value) => value?.status === 'queued',
    'attempt2_message_timeout',
  );
  await service.singleRunDebug.stopDispatcher();
  ids.message2_id = message2.id;
  const attempt1Terminal = await exactState(message1.id);
  assertion(
    attempt1Terminal.task_status === 'completed' &&
      attempt1Terminal.run_status === 'succeeded' &&
      attempt1Terminal.dispatch_published,
    'attempt1_not_terminal_through_dispatcher',
  );
  assertion(replayBefore && replayAfter, 'replay_observation_missing');
  assertion(
    replayBefore.id === replayAfter.id &&
      replayBefore.dedup_key === replayAfter.dedup_key &&
      replayBefore.body_hash === replayAfter.body_hash &&
      replayBefore.status === replayAfter.status,
    'replay_message_mutated',
  );
  const queuedAttempt2 = await exactState(message2.id);
  const reworkControl = await teamControl();
  assertion(
    queuedAttempt2.message_status === 'queued' &&
      queuedAttempt2.counts.messages === 1 &&
      queuedAttempt2.counts.tasks === 0 &&
      queuedAttempt2.counts.runs === 0 &&
      queuedAttempt2.counts.dispatches === 0,
    'attempt2_queued_state_invalid',
  );
  assertion(
    reworkControl.control_state === 'member_work_running',
    'rework_control_state_invalid',
  );
  marker('ATTEMPT2_QUEUED_AND_COMMAND_REPLAYED', {
    pre: {
      message_id: replayBefore.id,
      message_status: replayBefore.status,
      dedup_key: replayBefore.dedup_key,
      body_hash: replayBefore.body_hash,
    },
    expected: {
      replay_same_message: true,
      message_status: 'queued',
      counts: { messages: 1, tasks: 0, runs: 0, dispatches: 0 },
    },
    actual: {
      replay_same_message: true,
      message_id: replayAfter.id,
      message_status: replayAfter.status,
      dedup_key: replayAfter.dedup_key,
      body_hash: replayAfter.body_hash,
      counts: queuedAttempt2.counts,
      control_state: reworkControl.control_state,
    },
  });

  const faultApplied = await db.query(
    "UPDATE tasks SET status='active',updated_at=now() WHERE id=$1 AND status='completed'",
    [ids.attempt1_task_id],
  );
  assertion(faultApplied.rowCount === 1, 'active_task_fault_not_applied');
  let rejectionCode = null;
  try {
    await service.singleRunDebug.rebuildQueuedTeamWakes();
  } catch (error) {
    rejectionCode =
      error instanceof Error ? error.message.split(':', 1)[0] : 'unknown';
  }
  assertion(rejectionCode, 'conflicting_active_task_not_rejected');
  const rejectedState = await exactState(message2.id);
  assertion(
    rejectedState.message_status === 'queued' &&
      rejectedState.counts.tasks === 0 &&
      rejectedState.counts.runs === 0 &&
      rejectedState.counts.dispatches === 0,
    'rejected_materialization_did_not_rollback',
  );
  const faultRestored = await db.query(
    "UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND status='active'",
    [ids.attempt1_task_id],
  );
  assertion(faultRestored.rowCount === 1, 'active_task_fault_not_restored');
  marker('REJECTED_MATERIALIZATION_ROLLED_BACK', {
    pre: { conflicting_active_task_id: ids.attempt1_task_id },
    expected: {
      rejected: true,
      message_status: 'queued',
      counts: { messages: 1, tasks: 0, runs: 0, dispatches: 0 },
    },
    actual: {
      rejected: true,
      rejection_code: rejectionCode,
      state: rejectedState,
    },
  });

  const resumed = await service.singleRunDebug.rebuildQueuedTeamWakes();
  const resumedAgain = await service.singleRunDebug.rebuildQueuedTeamWakes();
  assertion(resumed === 1 && resumedAgain === 0, 'startup_rebuild_invalid');
  const materialized2 = await exactState(message2.id);
  ids.attempt2_task_id = materialized2.task_id;
  ids.attempt2_run_id = materialized2.run_id;
  marker('FRESH_RECONCILER_REBUILT_DURABLE_WAKE', {
    pre: { message_status: 'queued', dispatcher_paused: true },
    expected: {
      first_reconcile: 1,
      second_reconcile: 0,
      task_status: 'queued',
      run_status: 'queued',
    },
    actual: {
      first_reconcile: resumed,
      second_reconcile: resumedAgain,
      state: materialized2,
    },
  });

  service.singleRunDebug.startDispatcher();
  const finalTeam = await waitFor(
    async () =>
      (
        await db.query('SELECT status,phase FROM team_runs WHERE id=$1', [
          ids.team_run_id,
        ])
      ).rows[0],
    (value) => ['succeeded', 'failed', 'cancelled'].includes(value?.status),
    'team_terminal_timeout',
    60_000,
  );
  await service.singleRunDebug.stopDispatcher();
  assertion(finalTeam.status === 'succeeded', 'team_not_succeeded');
  const terminalControl = await teamControl();
  assertion(
    acceptControl?.control_state === 'lead_ready' &&
      acceptControl.completion_requested_by_run_id === null,
    'accept_control_state_invalid',
  );
  assertion(
    finishControl?.control_state === 'lead_running' &&
      typeof finishControl.completion_requested_by_run_id === 'string',
    'finish_control_state_invalid',
  );
  assertion(
    terminalControl.control_state === 'terminal' &&
      terminalControl.status === 'succeeded' &&
      terminalControl.phase === 'done',
    'terminal_control_state_invalid',
  );
  const final2 = await exactState(message2.id);
  assertion(
    final2.message_status === 'consumed' &&
      final2.task_status === 'completed' &&
      final2.run_status === 'succeeded' &&
      final2.dispatch_published &&
      final2.source_team_message_id === message2.id &&
      JSON.stringify(final2.input_team_message_ids) ===
        JSON.stringify([message2.id]) &&
      final2.source_message_id === null &&
      final2.counts.messages === 1 &&
      final2.counts.tasks === 1 &&
      final2.counts.runs === 1 &&
      final2.counts.dispatches === 1,
    'attempt2_final_state_invalid',
  );
  const attemptRows = await db.query(
    `SELECT attempt_no,status,assignee_member_id,execution_task_id
       FROM team_work_item_attempts
      WHERE team_run_id=$1 ORDER BY attempt_no`,
    [ids.team_run_id],
  );
  assertion(
    attemptRows.rows.length === 2 &&
      attemptRows.rows.every(
        (row) =>
          row.status === 'completed' && row.assignee_member_id === member.id,
      ),
    'same_member_attempts_not_terminal',
  );
  const forbidden = await db.query(
    "SELECT to_regclass('public.team_turn_requests') AS relation",
  );
  assertion(forbidden.rows[0].relation === null, 'team_turn_request_exists');
  const finalKernel = await db.query(
    `SELECT t.status AS root_task_status,r.status AS root_run_status,
            m.status AS member_status,
            (SELECT count(*)::int FROM tasks active_task
              WHERE active_task.root_task_id=t.id
                AND active_task.team_member_run_id=m.id
                AND active_task.status NOT IN ('completed','failed','cancelled')) AS active_member_tasks
       FROM tasks t
       JOIN runs r ON r.task_id=t.id
       JOIN team_member_runs m ON m.id=$2
      WHERE t.id=$1 AND r.id=$3`,
    [rootTaskId, member.id, ids.root_run_id],
  );
  assertion(
    finalKernel.rows.length === 1 &&
      finalKernel.rows[0].root_task_status === 'completed' &&
      finalKernel.rows[0].root_run_status === 'succeeded' &&
      finalKernel.rows[0].member_status === 'idle' &&
      finalKernel.rows[0].active_member_tasks === 0,
    'final_kernel_state_invalid',
  );
  marker('RESULT_PASS', {
    expected: {
      same_team_run: true,
      same_member: true,
      exact_cardinality: true,
      product_session_provenance_unchanged: true,
      no_second_queue: true,
      team_status: 'succeeded',
    },
    actual: {
      same_team_run: true,
      same_member: true,
      attempts: attemptRows.rows,
      message1: attempt1Terminal,
      message2: final2,
      product_session_provenance_unchanged: final2.source_message_id === null,
      team_turn_requests: false,
      kernel: finalKernel.rows[0],
      control_states: {
        assignment: assignmentControl.control_state,
        rework: reworkControl.control_state,
        after_accept: acceptControl.control_state,
        after_finish_request: finishControl.control_state,
        terminal: terminalControl.control_state,
      },
      team_status: finalTeam.status,
      team_phase: finalTeam.phase,
    },
  });
  await writeEvidence('passed');
} catch (error) {
  await writeEvidence('blocked', error);
  throw error;
} finally {
  await service?.singleRunDebug?.stopDispatcher?.().catch(() => undefined);
  await new Promise(
    (resolveClose) => api?.close?.(() => resolveClose()) ?? resolveClose(),
  ).catch(() => undefined);
  await service?.close?.().catch(() => undefined);
  await db?.end?.().catch(() => undefined);
  await admin?.end?.().catch(() => undefined);
}
