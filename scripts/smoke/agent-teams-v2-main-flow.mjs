import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register as registerTsx } from 'tsx/esm/api';

registerTsx();

import { serve } from '@hono/node-server';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { Client as PostgresClient } from 'pg';
import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
  waitForHttp,
} from '../dev/paseo-process.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const adminUrl = process.env.POSTGRES_ADMIN_URL;
const timeoutSeconds = Number(
  process.env.AGENT_TEAMS_V2_SMOKE_TIMEOUT_SECONDS ?? '180',
);
const runtimeTimeoutSeconds = Number(
  process.env.AGENT_TEAMS_V2_SMOKE_RUNTIME_TIMEOUT_SECONDS ?? '150',
);
const timeoutReserveSeconds = timeoutSeconds - runtimeTimeoutSeconds;
const requestedScriptedRuntime =
  process.env.AGENT_TEAMS_V2_SMOKE_RUNTIME === 'scripted';
const forceStall = process.env.AGENT_TEAMS_V2_SMOKE_FORCE_STALL === '1';
const failedAttemptMode =
  process.env.AGENT_TEAMS_V2_SMOKE_FAILED_ATTEMPT_MODE ?? '';
const expiredLeaseRecovery =
  process.env.AGENT_TEAMS_V2_SMOKE_EXPIRED_LEASE_RECOVERY ?? '';
const scriptedRuntime =
  requestedScriptedRuntime || Boolean(expiredLeaseRecovery);
const supportedPaidSmokeModels = new Set([
  'opencode-go/deepseek-v4-flash',
  'opencode-go/mimo-v2.5',
  'opencode-go/glm-5.2',
]);
if (!['', 'lead', 'members'].includes(expiredLeaseRecovery))
  throw new Error('invalid_expired_lease_recovery');
if (!['', 'baseline', 'fixed'].includes(failedAttemptMode))
  throw new Error('invalid_failed_attempt_mode');
const requestedModel =
  process.env.PASEO_MODEL ?? 'opencode-go/deepseek-v4-flash';
const startedAt = Date.now();
const suffix = randomUUID().slice(0, 8);
const databaseName = `agent_teams_v2_${startedAt}_${suffix}`;
const evidenceRoot = join(
  root,
  '.local',
  `agent-teams-v2-${startedAt}-${suffix}`,
);
const runtimeRoot = join(
  root,
  '.local',
  `agent-teams-v2-runtime-${startedAt}-${suffix}`,
);
const token = `agent-teams-v2-${randomUUID()}`;
const foreignToken = `agent-teams-v2-foreign-${randomUUID()}`;
const tenantId = 'tenant_agent_teams_v2';
const principalId = 'svc_agent_teams_v2';
const workspaceId = randomUUID();
const canonicalSnapshotInvocation =
  'synthetic_stock_snapshot({fixture_ref:"fixture://self-learning-market-research/acme-v1",symbol:"ACME"})';
const markers = [];
const stderr = [];
const runtimeCalls = [];
const runtimeTrace = [];
let admin;
let db;
let service;
let api;
let paseo;
let apiUrl;
let rootTaskId;
let teamRunId;
let databaseUrl;
let failureDiagnostic;
class RecoveryComplete extends Error {}
let scriptedRuntimeInstance;

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sameUniqueRefs(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    right.every((ref) => left.includes(ref))
  );
}
function normalizedProjectionKey(key) {
  return key.replace(/[^a-z0-9]/giu, '').toLowerCase();
}
function assertSafeProjection(value, path = 'projection') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSafeProjection(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizedProjectionKey(key);
      assert(
        ![
          'runtimesessionid',
          'provideragentid',
          'provider',
          'owner',
          'prompt',
          'credential',
        ].includes(normalized),
        `forbidden_projection_key_${normalized}`,
      );
      assertSafeProjection(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value !== 'string') return;
  assert(
    !/\bbearer\s+(?!\[redacted(?: path)?\])\S+/iu.test(value),
    `forbidden_projection_bearer_${path}`,
  );
  assert(
    !/\b(?:credential|token|password|secret|api[_ -]?key)\s*[:=]\s*(?!\[redacted(?: path)?\])\S+/iu.test(
      value,
    ),
    `forbidden_projection_key_value_${path}`,
  );
  assert(
    !/(?:\/(?:Users|Volumes)\/|~\/|(?:^|[\s"'([{])[A-Za-z]:[\\/])/u.test(value),
    `forbidden_projection_path_${path}`,
  );
  assert(
    !/canary-secret|\/Users\/canary/iu.test(value),
    `forbidden_projection_canary_${path}`,
  );
}
function assertProjectionScannerSelfCheck() {
  assertSafeProjection({
    narration:
      'Lead redacted the credential/path fragments; Bearer [redacted]; [redacted path].',
  });
  for (const [label, value] of [
    ['camel_key', { runtimeSessionId: 'x' }],
    ['snake_key', { runtime_session_id: 'x' }],
    ['bearer', { note: 'Bearer leaked-value' }],
    ['key_value', { note: 'token=leaked-value' }],
    ['path', { note: '/Volumes/private' }],
    ['canary', { note: 'canary-secret' }],
  ]) {
    let rejected = false;
    try {
      assertSafeProjection(value, `self_check.${label}`);
    } catch {
      rejected = true;
    }
    assert(rejected, `projection_scanner_self_check_${label}`);
  }
}
function safe(value) {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /(?:token|secret|password|credential|api.?key|prompt|body|content|owner|runtime_session|provider|path|id)$/iu.test(
          key,
        )
          ? '[redacted]'
          : safe(entry),
      ]),
    );
  if (typeof value !== 'string') return value;
  return value
    .replace(/bearer\s+\S+/giu, 'bearer [redacted]')
    .replace(/\/(?:Users|Volumes|tmp|workspace|app)\/[^\s"']+/gu, '[path]')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1024);
}
function failureCode(error) {
  const candidates = [
    error && typeof error === 'object' ? error.code : undefined,
    error instanceof Error ? error.message : undefined,
  ];
  return (
    candidates.find(
      (candidate) =>
        typeof candidate === 'string' &&
        /^(?:[A-Za-z][A-Za-z0-9_]{0,127}|[0-9]{5})$/u.test(candidate),
    ) ?? 'unexpected_failure'
  );
}
function sanitizedErrorDetail(error) {
  const source = error && typeof error === 'object' ? error : undefined;
  const code =
    typeof source?.code === 'string' &&
    /^(?:[A-Za-z][A-Za-z0-9_]{0,127}|[0-9]{5})$/u.test(source.code)
      ? source.code
      : failureCode(error);
  const name =
    typeof source?.name === 'string'
      ? source.name.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 96)
      : 'Error';
  const message = String(
    source?.message ??
      (typeof error === 'string' ? error : 'unexpected failure'),
  )
    .replace(/bearer\s+\S+/giu, 'bearer [redacted]')
    .replace(
      /\b(?:credential|token|password|secret|api[_ -]?key)\s*[:=]\s*\S+/giu,
      '[redacted]',
    )
    .replace(/https?:\/\/[^\s"']+/giu, '[url]')
    .replace(/\/(?:Users|Volumes|tmp|workspace|app)\/[^\s"']+/gu, '[path]')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 256);
  return { code, name, message };
}
function smokeFailure(error) {
  const detail = sanitizedErrorDetail(error);
  return Object.assign(
    new Error(
      `SMOKE_MAIN_FLOW_FAILED:${detail.code}:${detail.name}:${detail.message}`,
      { cause: error },
    ),
    { code: detail.code, detail },
  );
}
function marker(name, fields = {}) {
  const entry = safe({ marker: name, at: new Date().toISOString(), ...fields });
  markers.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
async function evidence(result, error) {
  if (error)
    stderr.push(
      JSON.stringify({ error: error.detail ?? sanitizedErrorDetail(error) }),
    );
  const manifest = safe({
    schema: 'agent-teams-v2-real-server-v1',
    result,
    node_version: process.version,
    execution: {
      command: 'pnpm smoke:agent-teams-v2',
      timeout_seconds: timeoutSeconds,
      runtime_timeout_seconds: runtimeTimeoutSeconds,
      paseo_execution_timeout_ms: runtimeTimeoutSeconds * 1_000,
      timeout_reserve_seconds: timeoutReserveSeconds,
      elapsed_ms: Date.now() - startedAt,
      process_exit_code: result === 'passed' ? 0 : 1,
    },
    composition: {
      create_service: true,
      tcp_http_server: true,
      canonical_api_setup_and_invoke: true,
      runtime_mcp_http: true,
      postgres_run_dispatcher: true,
      provider_used: !scriptedRuntime,
      paseo_used: !scriptedRuntime,
      model: scriptedRuntime ? 'scripted' : requestedModel,
      deterministic_substitution_scope: scriptedRuntime
        ? 'provider runtime driver and model decisions'
        : 'none',
    },
    markers,
    runtime_calls: runtimeCalls,
    ...(failureDiagnostic ? { failure_diagnostic: failureDiagnostic } : {}),
    credentials: scriptedRuntime ? '[absent]' : '[provided-redacted]',
    prompts: '[absent]',
    stderr_empty: stderr.length === 0,
  });
  const paths = {
    manifest: join(evidenceRoot, 'manifest.json'),
    stdout: join(evidenceRoot, 'stdout.ndjson'),
    stderr: join(evidenceRoot, 'stderr.ndjson'),
  };
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await chmod(evidenceRoot, 0o700);
  for (const [key, content] of Object.entries({
    manifest: JSON.stringify(manifest, null, 2),
    stdout: markers.map((entry) => JSON.stringify(entry)).join('\n'),
    stderr: stderr.join('\n'),
  })) {
    const target = paths[key];
    const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temp, `${content}\n`, { mode: 0o600 });
    await rename(temp, target);
    await chmod(target, 0o600);
  }
}
async function collectFailureDiagnostic(failure) {
  const detail = failure?.detail ?? sanitizedErrorDetail(failure);
  const diagnostic = {
    error: detail,
    ...(rootTaskId ? { root_task_ref: rootTaskId } : {}),
    ...(teamRunId ? { team_run_ref: teamRunId } : {}),
  };
  if (!db || !rootTaskId) {
    failureDiagnostic = diagnostic;
    marker('FAILURE_DIAGNOSTIC_CAPTURED', failureDiagnostic);
    return;
  }
  try {
    const team = teamRunId
      ? (
          await db.query(
            `SELECT id AS team_ref,status,phase,control_state,revision,lead_turn_count,stop_reason
               FROM team_runs WHERE id=$1`,
            [teamRunId],
          )
        ).rows[0]
      : undefined;
    const members = (
      await db.query(
        `SELECT id AS member_ref,status,current_work_item_id AS work_ref
           FROM team_member_runs WHERE team_run_id=$1 ORDER BY id LIMIT 64`,
        [teamRunId],
      )
    ).rows;
    const work = (
      await db.query(
        `SELECT id AS work_ref,status,execution_task_id AS task_ref
           FROM team_work_items WHERE team_run_id=$1 ORDER BY id LIMIT 64`,
        [teamRunId],
      )
    ).rows;
    const attempts = (
      await db.query(
        `SELECT id AS attempt_ref,status,work_item_id AS work_ref,assignee_member_id AS member_ref,
                execution_task_id AS task_ref
           FROM team_work_item_attempts WHERE team_run_id=$1 ORDER BY id LIMIT 64`,
        [teamRunId],
      )
    ).rows;
    const tasksAndRuns = (
      await db.query(
        `SELECT t.id AS task_ref,t.team_task_kind,t.status AS task_status,
                r.id AS run_ref,r.status AS run_status,
                (r.lease_owner IS NOT NULL) AS lease_present,
                r.lease_expires_at,r.fencing_token,
                (d.published_at IS NOT NULL) AS dispatch_published
           FROM tasks t
           LEFT JOIN runs r ON r.task_id=t.id
           LEFT JOIN run_dispatches d ON d.run_id=r.id AND d.event_type='run.enqueue'
          WHERE t.root_task_id=$1
          ORDER BY t.id,r.id
          LIMIT 32`,
        [rootTaskId],
      )
    ).rows.map((row) => ({
      task_ref: row.task_ref,
      ...(row.run_ref ? { run_ref: row.run_ref } : {}),
      ...(row.team_task_kind ? { task_kind: row.team_task_kind } : {}),
      task_status: row.task_status,
      run_status: row.run_status ?? null,
      lease_present: row.lease_present ?? false,
      lease_expires_at:
        row.lease_expires_at instanceof Date
          ? row.lease_expires_at.toISOString()
          : row.lease_expires_at === null || row.lease_expires_at === undefined
            ? null
            : String(row.lease_expires_at),
      activation_fence: row.fencing_token ?? null,
      dispatch_published: row.dispatch_published ?? null,
    }));
    const queuedMessages = (
      await db.query(
        `SELECT id AS message_ref,kind,status,consumed_by_task_id AS consumed_task_ref
           FROM team_messages WHERE team_run_id=$1 AND status='queued' ORDER BY id
           LIMIT 64`,
        [teamRunId],
      )
    ).rows;
    failureDiagnostic = {
      ...diagnostic,
      ...(team ? { team } : {}),
      members,
      work,
      attempts,
      tasks_and_runs: tasksAndRuns,
      queued_messages: queuedMessages,
    };
  } catch (diagnosticError) {
    failureDiagnostic = {
      ...diagnostic,
      diagnostic_query_failed: true,
    };
  }
  marker('FAILURE_DIAGNOSTIC_CAPTURED', failureDiagnostic);
}
function value(result) {
  const output = result?.structuredContent;
  assert(
    output && typeof output === 'object' && !output.error,
    `mcp_${output?.error ?? 'invalid'}`,
  );
  return output;
}

class ScriptedRuntime {
  #sessions = new Map();
  #leadTurns = 0;
  #leadProviderBindings = new Set();
  #memberTurns = 0;
  #submittedTimeoutInjected = false;
  #failedAttemptInjected = false;
  #leadFailureCodeObserved = false;
  #cancelReplayEqual = false;
  get cancelReplayEqual() {
    return this.#cancelReplayEqual;
  }
  get leadFailureCodeObserved() {
    return this.#leadFailureCodeObserved;
  }
  #pendingLeadIdle = [];
  async assertLeadIdle() {
    await Promise.all(this.#pendingLeadIdle.splice(0));
  }
  scheduleLeadIdle(client, turn) {
    this.#pendingLeadIdle.push(
      new Promise((resolve, reject) => {
        setImmediate(async () => {
          try {
            const listed = await client.listTools();
            assert(
              listed.tools.some((tool) => tool.name === 'team_state'),
              `lead_turn_${turn}_catalog_disappeared`,
            );
            const response = await client.callTool({
              name: 'team_state',
              arguments: {},
            });
            assert(
              response.structuredContent?.error === 'unauthorized',
              `lead_turn_${turn}_idle_authority_not_narrowed`,
            );
            const mutation = await client.callTool({
              name: 'team_work_create',
              arguments: { subject: 'old-turn-forbidden', assignee: 'member' },
            });
            assert(
              mutation.structuredContent?.error === 'unauthorized',
              `lead_turn_${turn}_old_mutation_not_rejected`,
            );
            runtimeCalls.push({
              role: 'lead',
              turn,
              idle_same_client_rejected: true,
              old_turn_mutation_rejected: true,
            });
            marker('LEAD_IDLE_REJECTED', {
              turn,
              old_turn_mutation_rejected: true,
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }),
    );
  }
  async initialize() {}
  async health() {
    return {
      ready: true,
      provider: 'deterministic',
      model: 'scripted',
      checks: [],
    };
  }
  async execute(input) {
    await this.assertLeadIdle();
    let providerAgentId = input.providerAgentId;
    let session;
    if (input.operation === 'create') {
      const extension = input.extensions?.mcpServers?.[0];
      assert(
        extension?.url && extension.headers?.Authorization,
        'runtime_mcp_missing',
      );
      const client = new McpClient({
        name: 'agent-teams-v2-smoke',
        version: '1.0.0',
      });
      const transport = new StreamableHTTPClientTransport(
        new URL(extension.url),
        { requestInit: { headers: extension.headers } },
      );
      await client.connect(transport);
      providerAgentId = `scripted-${randomUUID()}`;
      session = {
        client,
        transport,
        workspaceId: `scripted-workspace-${randomUUID()}`,
      };
      this.#sessions.set(providerAgentId, session);
    } else {
      session = this.#sessions.get(providerAgentId);
      assert(session, 'runtime_session_missing');
    }
    const tools = new Set(
      (await session.client.listTools()).tools.map((tool) => tool.name),
    );
    const assertForbidden = async (name, args, code) => {
      const response = await session.client.callTool({ name, arguments: args });
      marker('SCRIPTED_FORBIDDEN_RESPONSE', {
        turn: this.#leadTurns,
        tool: name,
        response: safe(response.structuredContent ?? null),
      });
      assert(response.structuredContent?.error === 'unauthorized', code);
      runtimeCalls.push({
        role: 'lead',
        turn: this.#leadTurns,
        forbidden_rejected: true,
        forbidden_tool: name,
      });
    };
    const directTurn = input.prompt.includes('phase3-direct-sentinel');
    runtimeCalls.push({
      kind: 'runtime_binding',
      role: directTurn
        ? 'direct'
        : tools.has('team_work_submit')
          ? 'member'
          : 'lead',
      operation: input.operation,
      provider_binding_hash: hash(providerAgentId),
    });
    if (directTurn) {
      assert(
        input.prompt.includes('phase3-direct-sentinel'),
        'direct_sentinel_not_observed',
      );
      assert(
        tools.has('team_state') && tools.has('team_work_list'),
        'direct_turn_safe_reads_missing',
      );
      let domainDenied = false;
      try {
        const attempted = await session.client.callTool({
          name: 'synthetic_stock_snapshot',
          arguments: {
            fixture_ref: 'fixture://self-learning-market-research/acme-v1',
            symbol: 'ACME',
          },
        });
        domainDenied =
          attempted.isError === true ||
          Boolean(attempted.structuredContent?.error);
      } catch {
        domainDenied = true;
      }
      assert(domainDenied, 'direct_turn_domain_tool_not_denied');
      runtimeCalls.push({
        role: 'direct',
        observed_sentinel: true,
        acknowledged: true,
        domain_tool_denied: true,
        tools: ['team_state', 'team_work_list'],
      });
    } else if (!tools.has('team_work_submit')) {
      this.#leadTurns += 1;
      const expectedLeadCatalog = new Set([
        'team_state',
        'team_work_list',
        'team_work_create',
        'team_work_accept',
        'team_work_cancel',
        'team_work_request_changes',
        'team_finish',
        'team_message_send',
      ]);
      assert(
        expectedLeadCatalog.size === tools.size &&
          [...expectedLeadCatalog].every((name) => tools.has(name)),
        `lead_turn_${this.#leadTurns}_catalog_invalid`,
      );
      if (this.#leadProviderBindings.size)
        assert(
          this.#leadProviderBindings.has(providerAgentId),
          `lead_turn_${this.#leadTurns}_provider_binding_changed`,
        );
      this.#leadProviderBindings.add(providerAgentId);
      assert(
        input.prompt.includes(
          'Lead control turns must not spawn, delegate to, or use provider subagents',
        ) &&
          input.prompt.includes(
            'A plain-text response or no-op is not control progress',
          ),
        'lead_control_protocol_missing',
      );
      if (this.#leadTurns === 1)
        assert(
          input.systemPrompt?.includes(canonicalSnapshotInvocation) &&
            input.systemPrompt.includes('Golden-path review rubric'),
          'lead_canonical_snapshot_accept_rubric_missing',
        );
      if (this.#leadTurns === 1)
        assert(tools.has('team_work_create'), 'lead_turn_1_create_missing');
      else
        assert(
          tools.has('team_work_create'),
          `lead_turn_${this.#leadTurns}_catalog_missing_create`,
        );
      if (this.#leadTurns === 1) {
        await assertForbidden(
          'team_finish',
          {},
          'finish_granted_on_empty_board',
        );
        value(
          await session.client.callTool({
            name: 'team_work_create',
            arguments: {
              subject: 'A',
              description:
                'Immediately collect and submit the required canonical snapshot evidence without creating a child subagent.',
              assignee: 'member',
            },
          }),
        );
        value(
          await session.client.callTool({
            name: 'team_work_create',
            arguments: {
              subject: 'B',
              description:
                'Perform the declared observer preflight, then collect and submit the required canonical snapshot evidence.',
              assignee: 'observer',
            },
          }),
        );
        runtimeCalls.push({
          role: 'lead',
          turn: 1,
          tools: ['create_A', 'create_B_independent'],
          zero_work_finish_absent: true,
        });
      } else if (this.#leadTurns === 2 && failedAttemptMode === 'fixed') {
        assert(
          input.prompt.includes('"failure_code":"runtime_execution_failed"'),
          'lead_failure_code_missing',
        );
        this.#leadFailureCodeObserved = true;
        const cancelled = value(
          await session.client.callTool({
            name: 'team_work_cancel',
            arguments: { work_ref: 'work-1' },
          }),
        );
        const replay = value(
          await session.client.callTool({
            name: 'team_work_cancel',
            arguments: { work_ref: 'work-1' },
          }),
        );
        assert(
          JSON.stringify(cancelled) === JSON.stringify(replay),
          'cancel_replay_not_equal',
        );
        this.#cancelReplayEqual = true;
        runtimeCalls.push({
          role: 'lead',
          turn: 2,
          tool: 'cancel_failed_work',
        });
      } else if (this.#leadTurns === 3 && failedAttemptMode === 'fixed') {
        assert(
          input.prompt.includes('"allowed_commands":["team_work_accept"]') ||
            input.prompt.includes('"team_work_accept"'),
          'lead_accept_after_cancel_missing',
        );
        value(
          await session.client.callTool({
            name: 'team_work_accept',
            arguments: { work_ref: 'work-2' },
          }),
        );
        runtimeCalls.push({
          role: 'lead',
          turn: 3,
          tool: 'accept_remaining_work',
        });
      } else if (this.#leadTurns === 2) {
        assert(
          input.prompt.includes('"assignee":"member"'),
          'lead_work_1_assignee_missing',
        );
        assert(
          tools.has('team_work_accept') &&
            tools.has('team_work_request_changes') &&
            tools.has('team_work_create'),
          'lead_review_tools_not_exact',
        );
        await assertForbidden(
          'team_work_create',
          { subject: 'forbidden', assignee: 'member' },
          'lead_create_not_denied',
        );
        value(
          await session.client.callTool({
            name: 'team_work_accept',
            arguments: { work_ref: 'work-1' },
          }),
        );
        runtimeCalls.push({ role: 'lead', turn: 2, tool: 'accept_A' });
      } else if (this.#leadTurns === 3) {
        assert(
          input.prompt.includes('"assignee":"observer"'),
          'lead_work_2_assignee_missing',
        );
        assert(
          input.prompt.includes(
            '"allowed_commands":["team_work_accept","team_work_request_changes"]',
          ) &&
            input.prompt.includes(
              '"available_coordination_commands":["team_message_send"]',
            ),
          'lead_review_coordination_contract_missing',
        );
        await assertForbidden(
          'team_finish',
          {},
          'finish_granted_before_B_accept',
        );
        value(
          await session.client.callTool({
            name: 'team_work_accept',
            arguments: { work_ref: 'work-2' },
          }),
        );
        const message = value(
          await session.client.callTool({
            name: 'team_message_send',
            arguments: {
              recipient: 'observer',
              summary:
                'phase3-direct-sentinel observer coordination Bearer canary-secret /Users/canary',
            },
          }),
        );
        const replay = value(
          await session.client.callTool({
            name: 'team_message_send',
            arguments: {
              recipient: 'observer',
              summary:
                'phase3-direct-sentinel observer coordination Bearer canary-secret /Users/canary',
            },
          }),
        );
        assert(
          JSON.stringify(message) === JSON.stringify(replay),
          'direct_message_equal_replay_invalid',
        );
        runtimeCalls.push({
          role: 'lead',
          turn: 3,
          tools: ['accept_B', 'direct_message'],
          direct_hash: hash(JSON.stringify(message)),
          direct_replay_equal: true,
          finish_absent: true,
        });
      } else {
        if (failedAttemptMode === 'fixed') {
          value(
            await session.client.callTool({
              name: 'team_finish',
              arguments: {},
            }),
          );
          runtimeCalls.push({
            role: 'lead',
            turn: this.#leadTurns,
            tool: 'finish_after_abandonment',
          });
          this.scheduleLeadIdle(session.client, this.#leadTurns);
          return {
            provider: 'deterministic',
            model: 'scripted',
            providerAgentId,
            paseoWorkspaceId: session.workspaceId,
            text: 'bounded turn completed',
            usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0 },
          };
        }
        await waitFor(
          async () =>
            (
              await db.query(
                "SELECT status FROM team_messages WHERE team_run_id=$1 AND kind='direct'",
                [teamRunId],
              )
            ).rows[0]?.status,
          (status) => status === 'delivered',
          'direct_delivery_before_finish',
        );
        let finished;
        try {
          finished = await session.client.callTool({
            name: 'team_finish',
            arguments: {},
          });
        } catch (error) {
          const detail =
            error && typeof error === 'object'
              ? error
              : { name: 'UnknownError', message: 'unknown' };
          marker('DIRECT_LEAD4_FINISH_THROWN', {
            error_name:
              typeof detail.name === 'string'
                ? detail.name.slice(0, 96)
                : 'UnknownError',
            ...(typeof detail.code === 'string'
              ? { error_code: detail.code.slice(0, 96) }
              : {}),
            error_message: String(detail.message ?? 'unknown')
              .replace(/bearer\s+\S+/giu, 'bearer [redacted]')
              .replace(
                /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/giu,
                '[id]',
              )
              .replace(/\/(?:Users|Volumes)\/[^\s"']+/gu, '[path]')
              .replace(/[\u0000-\u001f\u007f]/gu, ' ')
              .replace(/\s+/gu, ' ')
              .trim()
              .slice(0, 256),
          });
          throw error;
        }
        if (finished.structuredContent?.error) {
          marker('DIRECT_FINISH_FAILURE', {
            error: finished.structuredContent.error,
          });
          throw new Error(`direct_finish_${finished.structuredContent.error}`);
        }
        value(finished);
        runtimeCalls.push({
          role: 'lead',
          turn: this.#leadTurns,
          tool: 'finish_after_direct_delivery',
        });
      }
      this.scheduleLeadIdle(session.client, this.#leadTurns);
    } else {
      assert(tools.has('team_work_submit'), 'member_tools_missing');
      assert(!tools.has('team_message_send'), 'member_message_send_listed');
      assert(
        tools.has('synthetic_stock_snapshot'),
        'member_domain_tool_missing',
      );
      assert(
        input.systemPrompt?.includes(canonicalSnapshotInvocation) &&
          input.systemPrompt.includes('Never guess fixture_ref'),
        'member_canonical_snapshot_args_missing',
      );
      this.#memberTurns += 1;
      const memberState = value(
        await session.client.callTool({ name: 'team_state', arguments: {} }),
      );
      if (
        failedAttemptMode === 'baseline' ||
        (failedAttemptMode === 'fixed' &&
          !this.#failedAttemptInjected &&
          memberState.member?.name === 'member')
      ) {
        this.#failedAttemptInjected = true;
        throw new Error('forced member runtime failure before submit');
      }
      const memberTurn = memberState.member?.name === 'observer' ? 2 : 1;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          memberState.member?.name === 'observer' ? 1_000 : 200,
        ),
      );
      value(
        await session.client.callTool({
          name: 'synthetic_stock_snapshot',
          arguments: {
            fixture_ref: 'fixture://self-learning-market-research/acme-v1',
            symbol: 'ACME',
          },
        }),
      );
      const summary = `valid canonical snapshot ${canonicalSnapshotInvocation}; data_as_of=2026-07-31; bounded result ${memberTurn}`;
      value(
        await session.client.callTool({
          name: 'team_work_checkpoint',
          arguments: { summary },
        }),
      );
      value(
        await session.client.callTool({
          name: 'team_work_submit',
          arguments: { summary },
        }),
      );
      const rejectedAfterSubmit = async (
        name,
        args,
        { allowMissingTool = false } = {},
      ) => {
        let response;
        try {
          response = await session.client.callTool({
            name,
            arguments: args,
          });
        } catch (error) {
          if (
            allowMissingTool &&
            error instanceof McpError &&
            error.code === ErrorCode.MethodNotFound
          )
            return 'method_not_found';
          throw error;
        }
        const code = response.structuredContent?.error;
        assert(
          response.isError === true ||
            code === 'not_allowed' ||
            code === 'stale_state',
          `post_submit_${name}_not_rejected`,
        );
        return code ?? 'mcp_error';
      };
      const postSubmitRejections = {
        checkpoint: await rejectedAfterSubmit('team_work_checkpoint', {
          summary: `${summary} repeated checkpoint`,
        }),
        submit: await rejectedAfterSubmit('team_work_submit', {
          summary: `${summary} repeated submit`,
        }),
        message: await rejectedAfterSubmit(
          'team_message_send',
          {
            recipient: 'lead',
            summary: `${summary} forbidden member message`,
          },
          { allowMissingTool: true },
        ),
      };
      runtimeCalls.push({
        role: 'member',
        turn: memberTurn,
        tools: ['synthetic_stock_snapshot', 'checkpoint', 'submit'],
        post_submit_rejections: postSubmitRejections,
      });
      if (
        !this.#submittedTimeoutInjected &&
        memberState.member?.name === 'member'
      ) {
        this.#submittedTimeoutInjected = true;
        const { RuntimeTimedOutError } =
          await import('../../src/application/ports/agent-runtime.ts');
        throw new RuntimeTimedOutError();
      }
    }
    return {
      provider: 'deterministic',
      model: 'scripted',
      providerAgentId,
      paseoWorkspaceId: session.workspaceId,
      text: 'bounded turn completed',
      usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0 },
    };
  }
  async close() {
    for (const entry of this.#sessions.values())
      await entry.client.close().catch(() => undefined);
    this.#sessions.clear();
  }
}

async function request(
  path,
  { method = 'GET', body, status = 200, authToken = token } = {},
) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  assert(
    response.status === status,
    `http_${response.status}_expected_${status}`,
  );
  return json;
}
async function waitFor(load, predicate, code, ms = timeoutSeconds * 1000) {
  const deadline = Date.now() + ms;
  let current;
  while (Date.now() < deadline) {
    current = await load();
    if (predicate(current)) return current;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(code);
}
async function queued(kind) {
  const rows = await db.query(
    `SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id JOIN run_dispatches d ON d.run_id=r.id WHERE t.root_task_id=$1 AND r.status='queued' AND d.published_at IS NULL AND ($2::text IS NULL OR t.team_task_kind=$2) ORDER BY d.id LIMIT 1`,
    [rootTaskId, kind ?? null],
  );
  assert(rows.rowCount === 1, `queued_${kind ?? 'root'}_missing`);
  return rows.rows[0].id;
}
function agentYaml(name) {
  const lead = name === 'lead';
  const observer = name === 'observer';
  const instructions = lead
    ? `Act directly as the Team Lead using only the canonical Team tools exposed in the current turn. A Lead control turn must never spawn or delegate to a subagent. Read the board first, perform every required canonical control action for the current state, then stop. Golden-path review rubric: a completed latest attempt whose submitted result contains the valid canonical ${canonicalSnapshotInvocation} result is qualifying and must be accepted. Do not request changes for nonblocking wording, caveats, formatting, or internal-path text; request changes remains available only for missing or invalid canonical snapshot evidence or another blocking requirement. On the empty board: create Work A assigned to member with description exactly "Immediately collect and submit the required canonical snapshot evidence without creating a child subagent."; then create independent Work B assigned to observer with description exactly "Perform the declared observer preflight, then collect and submit the required canonical snapshot evidence."; do not send a direct message on this turn; then stop. Never create any other Work. When work-1 has a qualifying completed latest attempt, even though the WorkItem status remains in_progress, call team_work_accept exactly as {"work_ref":"work-1"} and stop, even while other members are running. When work-2 has a qualifying completed latest attempt, even though the WorkItem status remains in_progress, call team_work_accept exactly as {"work_ref":"work-2"}; only if available_coordination_commands includes team_message_send, then call team_message_send twice consecutively to observer with identical parameters and summary exactly the concatenation of "phase3-direct-sentinel observer coordination Bearer ", "canary-", and "secret /Users/canary"; do not call team_finish on this turn; then stop. On every later turn when both Work items are accepted, never send another direct message; if team_finish is exposed, call team_finish exactly once and stop. The server exposes team_finish only when delivery and completion fences are safe. Plain text is never a substitute for a required canonical action. The second identical team_message_send is the sole required idempotent replay; never repeat any other successful mutation, never invent refs, and never call a tool that is absent.`
    : `Act directly as the assigned Team member using only the canonical Team and domain tools exposed in the current turn. ${observer ? 'You are the observer. Do not create a child subagent. Before using the canonical snapshot tool, complete exactly eight sequential preflight rounds. In each round call team_state exactly once as the only tool call in that response, wait for its result, then call team_work_list exactly once as the only tool call in the next response and wait for its result. Never batch preflight calls. After round eight, immediately continue to the canonical snapshot.' : 'You are the primary member. Do not create a child subagent; complete the canonical snapshot immediately.'} The member must call ${canonicalSnapshotInvocation} exactly once. Never guess fixture_ref paths or use an internal path. Include the successful canonical fixture_ref, symbol ACME, and data_as_of 2026-07-31 in the completed result, then call team_work_checkpoint once with a short safe summary and team_work_submit once with that completed result. After the first successful submit, stop all Team mutation. Never call team_message_send, never mutate another Work, never repeat a successful mutation, and never invent refs.`;
  const refs = lead
    ? [
        'team-state',
        'team-work-list',
        'team-work-create',
        'team-work-accept-v2',
        'team-work-cancel',
        'team-finish',
        'team-message-send',
        'team-work-request-changes',
      ]
    : [
        'team-state',
        'team-work-list',
        'team-work-checkpoint',
        'team-work-submit',
        'synthetic-stock-snapshot',
      ];
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: v2-${name}\nspec:\n  description: V2 retained smoke role\n  instructions: ${JSON.stringify(instructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${refs.map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`).join('\n')}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute exactly the next legal Team transition for your role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
function environmentYaml() {
  return 'apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: v2-smoke\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n';
}
function teamYaml(lead, member, observer, environment) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: v2-smoke-team\nspec:\n  environmentVersionId: ${environment}\n  lead:\n    name: lead\n    agentVersionId: ${lead}\n  roster:\n    - name: member\n      agentVersionId: ${member}\n    - name: observer\n      agentVersionId: ${observer}\n  coordination:\n    taskAssignment: lead_or_self_claim\n`;
}
async function expectSqlState(query, values, code) {
  try {
    await db.query(query, values);
  } catch (error) {
    assert(error?.code === code, `sql_state_${error?.code}_expected_${code}`);
    return;
  }
  throw new Error(`sql_constraint_missing_${code}`);
}

try {
  assert(
    Number.isInteger(timeoutSeconds) && timeoutSeconds >= 30,
    'invalid_timeout',
  );
  assert(
    Number.isInteger(runtimeTimeoutSeconds) && runtimeTimeoutSeconds >= 1,
    'invalid_runtime_timeout',
  );
  assert(timeoutReserveSeconds >= 20, 'invalid_timeout_reserve');
  process.env.PASEO_EXECUTION_TIMEOUT_MS = String(
    runtimeTimeoutSeconds * 1_000,
  );
  marker('EXECUTION_BUDGETS_CONFIGURED', {
    timeout_seconds: timeoutSeconds,
    runtime_timeout_seconds: runtimeTimeoutSeconds,
    paseo_execution_timeout_ms: runtimeTimeoutSeconds * 1_000,
    timeout_reserve_seconds: timeoutReserveSeconds,
  });
  assert(adminUrl, 'missing_POSTGRES_ADMIN_URL');
  if (!scriptedRuntime) {
    assert(
      supportedPaidSmokeModels.has(requestedModel),
      'unsupported_paid_smoke_model',
    );
    assert(process.env.OPENCODE_GO_API_KEY, 'missing_OPENCODE_GO_API_KEY');
    const [providerId, modelId] = requestedModel.split('/');
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      agent: { build: { permission: 'allow' } },
      provider: {
        [providerId]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'OpenCode Go',
          options: {
            baseURL: 'https://opencode.ai/zen/go/v1',
            apiKey: '{env:OPENCODE_GO_API_KEY}',
          },
          models: {
            [modelId]: { name: modelId },
          },
        },
      },
    });
  }
  await Promise.all([
    mkdir(evidenceRoot, { recursive: true }),
    mkdir(join(runtimeRoot, 'project'), { recursive: true }),
    mkdir(join(runtimeRoot, 'cells'), { recursive: true }),
    mkdir(join(runtimeRoot, 'skills'), { recursive: true }),
  ]);
  await chmod(evidenceRoot, 0o700);
  admin = new PostgresClient({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  db = new PostgresClient({ connectionString: databaseUrl.toString() });
  await db.connect();
  if (!scriptedRuntime) {
    const paseoPort = await getAvailablePort();
    paseo = await startPaseo({
      repositoryRoot: root,
      runtimeRoot,
      port: paseoPort,
      environmentVariableNames: [
        'OPENCODE_GO_API_KEY',
        'OPENCODE_CONFIG_CONTENT',
      ],
    });
  }
  const apiPort = await getAvailablePort();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl.toString(),
    POSTGRES_URL: databaseUrl.toString(),
    PASEO_WS_URL: paseo?.wsUrl ?? 'ws://127.0.0.1:1',
    PASEO_MODEL: requestedModel,
    PASEO_AGENT_CWD: join(runtimeRoot, 'project'),
    PASEO_RUNTIME_CELL_ROOT: join(runtimeRoot, 'cells'),
    AGENT_SERVER_SKILL_REGISTRY_ROOT: join(runtimeRoot, 'skills'),
    SERVICE_ACCOUNTS_JSON: JSON.stringify([
      {
        serviceAccountId: principalId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'v2',
      },
      {
        serviceAccountId: `${principalId}_foreign`,
        token: foreignToken,
        tenantId: 'foreign',
        workspaceId: randomUUID(),
        policyVersion: 'v2',
      },
    ]),
  });
  const { loadConfig } = await import('../../src/shared/config.ts');
  const { createLogger } =
    await import('../../src/shared/observability/logger.ts');
  const { createService } = await import('../../src/bootstrap.ts');
  service = await createService(
    loadConfig(),
    createLogger({
      service: 'agent-teams-v2-smoke',
      minimumLevel: 'info',
      write: (line) => {
        const event = JSON.parse(line);
        if (
          typeof event.event === 'string' &&
          (event.event.startsWith('runtime.agent.create.') ||
            event.event.startsWith('runtime.message.send.'))
        )
          runtimeTrace.push({ event: event.event, runId: event.run_id });
      },
    }),
    {
      singleRunDebug: true,
      ...(scriptedRuntime
        ? {
            debugRuntime: (scriptedRuntimeInstance = new ScriptedRuntime()),
          }
        : {}),
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
  marker('REAL_SERVER_READY');
  await db.query(
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())',
    [workspaceId, tenantId, 'service_account', principalId, 'V2 smoke'],
  );
  const agents = {};
  for (const name of ['lead', 'member', 'observer']) {
    const imported = await request('/api/v1/agents:import', {
      method: 'POST',
      body: { source: agentYaml(name) },
      status: 201,
    });
    await request(`/api/v1/agent-versions/${imported.version.id}:publish`, {
      method: 'POST',
      body: {},
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
    { method: 'POST', body: {} },
  );
  const imported = await request('/api/v1/teams:import', {
    method: 'POST',
    body: {
      source: teamYaml(
        agents.lead,
        agents.member,
        agents.observer,
        environment.version.id,
      ),
    },
    status: 201,
  });
  const published = await request(
    `/api/v1/team-versions/${imported.version.id}:publish`,
    { method: 'POST', body: {} },
  );
  const invoked = await request('/api/v1/tasks:invoke', {
    method: 'POST',
    status: 202,
    body: {
      invokable: { kind: 'team', version_id: published.id },
      input: { text: 'bounded v2 retained smoke' },
    },
  });
  rootTaskId = invoked.task_id;
  marker('CANONICAL_API_INVOKED');
  const rootRun = await queued();
  assert(
    (await service.singleRunDebug.claimAndExecute(rootRun)).claimed,
    'root_not_claimed',
  );
  teamRunId = (
    await db.query('SELECT id FROM team_runs WHERE root_task_id=$1', [
      rootTaskId,
    ])
  ).rows[0]?.id;
  assert(teamRunId, 'team_missing');
  const roster = await db.query(
    'SELECT id,name,role,agent_version_id FROM team_member_runs WHERE team_run_id=$1',
    [teamRunId],
  );
  const lead = roster.rows.find((row) => row.name === 'lead');
  const member = roster.rows.find((row) => row.name === 'member');
  const observer = roster.rows.find((row) => row.name === 'observer');
  assert(lead && member && observer, 'roster_missing');
  const owner = {
    tenantId,
    workspaceId,
    principalType: 'service_account',
    principalId,
  };
  const queryOnly = (client) => ({ query: client.query.bind(client) });
  if (expiredLeaseRecovery === 'members') {
    const { PostgresRunRepository } =
      await import('../../src/infrastructure/postgres/postgres-run-repository.ts');
    const { PostgresTeamExecutionRepository } =
      await import('../../src/infrastructure/postgres/postgres-collaborative-team-repository.ts');
    const runsRepository = new PostgresRunRepository(queryOnly(db));
    const teamRepository = new PostgresTeamExecutionRepository(queryOnly(db));
    await service.singleRunDebug.claimAndExecute(await queued('lead_turn'));
    const materializedWakes =
      await service.singleRunDebug.rebuildQueuedTeamWakes();
    assert(materializedWakes === 2, 'expired_member_wakes_not_materialized');
    const workRuns = await db.query(
      `SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id
        WHERE t.root_task_id=$1 AND t.team_task_kind='work_attempt' AND r.status='queued' ORDER BY r.id`,
      [rootTaskId],
    );
    assert(workRuns.rowCount === 2, 'expired_member_work_runs_missing');
    const claimedMembers = [];
    for (const row of workRuns.rows) {
      const claimed = await runsRepository.claimQueuedById({
        runId: row.id,
        workerId: 'expired-member-recovery',
        activationId: randomUUID(),
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      assert(claimed, 'expired_member_claim_missing');
      claimedMembers.push(claimed);
    }
    const running = await db.query(
      `SELECT count(*)::int AS runs,
              count(*) FILTER (WHERE a.status='running')::int AS attempts
         FROM runs r JOIN tasks t ON t.id=r.task_id
         LEFT JOIN team_work_item_attempts a ON a.execution_task_id=t.id
        WHERE t.root_task_id=$1 AND t.team_task_kind='work_attempt' AND r.status='running'`,
      [rootTaskId],
    );
    assert(
      running.rows[0].runs === 2 && running.rows[0].attempts === 2,
      'expired_member_fixture_precondition_invalid',
    );
    marker('EXPIRED_CONCURRENT_MEMBER_LEASE_FIXTURE_ARMED', {
      shape: 'members_two_running_leased',
      process_restart_plumbing_covered: false,
    });
    const fixedNow = new Date(Date.now() + 600_000).toISOString();
    const expiredAt = new Date(Date.parse(fixedNow) - 60_000).toISOString();
    await db.query(
      `UPDATE runs SET lease_expires_at=$1::timestamptz WHERE id=ANY($2::uuid[])`,
      [expiredAt, claimedMembers.map((claim) => claim.run.id)],
    );
    const recovered = await teamRepository.recoverExpiredTeamRuns(fixedNow);
    marker('EXPIRED_MEMBER_RECOVERY_RETURN', {
      count: recovered.length,
      affected: recovered.map((item) => item.affectedChildRunCount),
      kinds: recovered.map((item) => item.teamTaskKind),
    });
    assert(
      recovered.length === 1 &&
        recovered[0].teamTaskKind === 'work_attempt' &&
        recovered[0].affectedChildRunCount === 2,
      'expired_member_recovery_invalid',
    );
    const replay = await teamRepository.recoverExpiredTeamRuns(fixedNow);
    assert(replay.length === 0, 'expired_member_recovery_not_idempotent');
    const facts = (
      await db.query(
        `SELECT team.status AS team_status,team.stop_reason,root_t.status AS root_task_status,root_r.status AS root_run_status FROM team_runs team JOIN tasks root_t ON root_t.id=team.root_task_id JOIN runs root_r ON root_r.task_id=root_t.id WHERE team.id=$1`,
        [teamRunId],
      )
    ).rows[0];
    const childTasks = (
      await db.query(
        `SELECT count(*)::int AS count FROM tasks WHERE root_task_id=$1 AND team_task_kind IS NOT NULL AND status NOT IN ('completed','failed','cancelled')`,
        [rootTaskId],
      )
    ).rows[0].count;
    const childRuns = (
      await db.query(
        `SELECT count(*)::int AS count FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.root_task_id=$1 AND t.team_task_kind IS NOT NULL AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')`,
        [rootTaskId],
      )
    ).rows[0].count;
    const childTaskStatuses = (
      await db.query(
        `SELECT id,status FROM tasks WHERE root_task_id=$1 AND team_task_kind IS NOT NULL ORDER BY id`,
        [rootTaskId],
      )
    ).rows;
    const activeAttempts = (
      await db.query(
        `SELECT count(*)::int AS count FROM team_work_item_attempts a JOIN tasks t ON t.id=a.execution_task_id WHERE t.root_task_id=$1 AND a.status IN ('queued','running')`,
        [rootTaskId],
      )
    ).rows[0].count;
    const triggerRunId = recovered[0].childRunId;
    const siblingRunId = claimedMembers.find(
      (claim) => claim.run.id !== triggerRunId,
    ).run.id;
    const memberStatuses = (
      await db.query(`SELECT id,status FROM runs WHERE id=ANY($1)`, [
        [triggerRunId, siblingRunId],
      ])
    ).rows;
    const triggerStatus = memberStatuses.find(
      (row) => row.id === triggerRunId,
    )?.status;
    const siblingStatus = memberStatuses.find(
      (row) => row.id === siblingRunId,
    )?.status;
    const memberAttemptStatuses = (
      await db.query(
        `SELECT execution_task_id,status FROM team_work_item_attempts WHERE execution_task_id=ANY($1)`,
        [claimedMembers.map((claim) => claim.taskId)],
      )
    ).rows;
    const recoveredChildTaskStatuses = (
      await db.query(
        `SELECT id,status FROM tasks WHERE id=ANY($1) ORDER BY id`,
        [claimedMembers.map((claim) => claim.taskId)],
      )
    ).rows;
    assert(
      facts.team_status === 'failed' &&
        facts.root_task_status === 'failed' &&
        facts.root_run_status === 'failed' &&
        facts.stop_reason === 'turn_lease_expired' &&
        childTasks === 0 &&
        childRuns === 0 &&
        activeAttempts === 0 &&
        childTaskStatuses.length > 0 &&
        childTaskStatuses.every((row) =>
          ['completed', 'failed', 'cancelled'].includes(row.status),
        ) &&
        recoveredChildTaskStatuses.length === 2 &&
        recoveredChildTaskStatuses.every((row) => row.status === 'failed') &&
        triggerStatus === 'timed_out' &&
        siblingStatus === 'failed' &&
        memberAttemptStatuses.length === 2 &&
        memberAttemptStatuses.every((row) => row.status === 'failed'),
      'expired_member_terminal_state_invalid',
    );
    marker('EXPIRED_CONCURRENT_MEMBER_LEASE_RECOVERY_PROVEN', {
      trigger_status: triggerStatus,
      sibling_status: siblingStatus,
      attempt_statuses: memberAttemptStatuses.map((row) => row.status),
      root_task_status: facts.root_task_status,
      root_run_status: facts.root_run_status,
      team_status: facts.team_status,
      stop_reason: facts.stop_reason,
      child_task_statuses: childTaskStatuses.map((row) => row.status),
      recovered_child_task_statuses: recoveredChildTaskStatuses.map(
        (row) => row.status,
      ),
      affected_count: recovered[0].affectedChildRunCount,
      nonterminal_task_count: childTasks,
      nonterminal_run_count: childRuns,
      nonterminal_attempt_count: activeAttempts,
      replay_recovery_count: replay.length,
    });
    marker('EXPIRED_LEASE_RECOVERY_IN_PROCESS_PROVEN', {
      mode: 'members',
      process_restart_plumbing_covered: false,
    });
    throw new RecoveryComplete();
  }
  if (expiredLeaseRecovery === 'lead') {
    const { PostgresRunRepository } =
      await import('../../src/infrastructure/postgres/postgres-run-repository.ts');
    const { PostgresTeamExecutionRepository } =
      await import('../../src/infrastructure/postgres/postgres-collaborative-team-repository.ts');
    const runsRepository = new PostgresRunRepository(queryOnly(db));
    const teamRepository = new PostgresTeamExecutionRepository(queryOnly(db));
    const leadRunId = await queued('lead_turn');
    const claimed = await runsRepository.claimQueuedById({
      runId: leadRunId,
      workerId: 'expired-lease-recovery',
      activationId: randomUUID(),
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    assert(claimed, 'expired_lead_claim_missing');
    const precondition = await db.query(
      `SELECT count(*)::int AS count FROM runs r JOIN tasks t ON t.id=r.task_id
        WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn' AND r.status='running' AND r.lease_expires_at IS NOT NULL`,
      [rootTaskId],
    );
    assert(
      precondition.rows[0].count === 1,
      'expired_lead_fixture_precondition_invalid',
    );
    marker('EXPIRED_LEAD_LEASE_FIXTURE_ARMED', {
      shape: 'lead_one_running_leased',
      process_restart_plumbing_covered: false,
    });
    const fixedNow = new Date(Date.now() + 600_000).toISOString();
    const expiredAt = new Date(Date.parse(fixedNow) - 60_000).toISOString();
    await db.query(
      `UPDATE runs SET lease_expires_at=$1::timestamptz WHERE id=$2`,
      [expiredAt, leadRunId],
    );
    const recovered = await teamRepository.recoverExpiredTeamRuns(fixedNow);
    assert(
      recovered.length === 1 &&
        recovered[0].teamTaskKind === 'lead_turn' &&
        recovered[0].affectedChildRunCount === 1,
      'expired_lead_recovery_invalid',
    );
    const replay = await teamRepository.recoverExpiredTeamRuns(fixedNow);
    assert(replay.length === 0, 'expired_lead_recovery_not_idempotent');
    const facts = (
      await db.query(
        `SELECT team.status AS team_status,team.stop_reason,root_t.status AS root_task_status,root_r.status AS root_run_status FROM team_runs team JOIN tasks root_t ON root_t.id=team.root_task_id JOIN runs root_r ON root_r.task_id=root_t.id WHERE team.id=$1`,
        [teamRunId],
      )
    ).rows[0];
    const childTasks = (
      await db.query(
        `SELECT count(*)::int AS count FROM tasks WHERE root_task_id=$1 AND team_task_kind IS NOT NULL AND status NOT IN ('completed','failed','cancelled')`,
        [rootTaskId],
      )
    ).rows[0].count;
    const childRuns = (
      await db.query(
        `SELECT count(*)::int AS count FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.root_task_id=$1 AND t.team_task_kind IS NOT NULL AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')`,
        [rootTaskId],
      )
    ).rows[0].count;
    const childTaskStatuses = (
      await db.query(
        `SELECT id,status FROM tasks WHERE root_task_id=$1 AND team_task_kind IS NOT NULL ORDER BY id`,
        [rootTaskId],
      )
    ).rows;
    const activeAttempts = (
      await db.query(
        `SELECT count(*)::int AS count FROM team_work_item_attempts a JOIN tasks t ON t.id=a.execution_task_id WHERE t.root_task_id=$1 AND a.status IN ('queued','running')`,
        [rootTaskId],
      )
    ).rows[0].count;
    const leadTriggerStatus = (
      await db.query(`SELECT status FROM runs WHERE id=$1`, [
        recovered[0].childRunId,
      ])
    ).rows[0]?.status;
    const leadSiblingStatuses = (
      await db.query(
        `SELECT r.status FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn' AND r.id<>$2 ORDER BY r.id`,
        [rootTaskId, recovered[0].childRunId],
      )
    ).rows.map((row) => row.status);
    assert(
      facts.team_status === 'failed' &&
        facts.root_task_status === 'failed' &&
        facts.root_run_status === 'failed' &&
        facts.stop_reason === 'turn_lease_expired' &&
        childTasks === 0 &&
        childRuns === 0 &&
        activeAttempts === 0 &&
        childTaskStatuses.length > 0 &&
        childTaskStatuses.every((row) => row.status === 'failed') &&
        leadTriggerStatus === 'timed_out' &&
        leadSiblingStatuses.every((status) => status === 'failed'),
      'expired_lead_terminal_state_invalid',
    );
    marker('EXPIRED_LEAD_LEASE_RECOVERY_PROVEN', {
      trigger_status: leadTriggerStatus,
      sibling_status: leadSiblingStatuses,
      root_task_status: facts.root_task_status,
      root_run_status: facts.root_run_status,
      team_status: facts.team_status,
      stop_reason: facts.stop_reason,
      child_task_statuses: childTaskStatuses.map((row) => row.status),
      affected_count: recovered[0].affectedChildRunCount,
      nonterminal_task_count: childTasks,
      nonterminal_run_count: childRuns,
      nonterminal_attempt_count: activeAttempts,
      replay_recovery_count: replay.length,
    });
    marker('EXPIRED_LEASE_RECOVERY_IN_PROCESS_PROVEN', {
      mode: 'lead',
      process_restart_plumbing_covered: false,
    });
    throw new RecoveryComplete();
  }
  await service.singleRunDebug.claimAndExecute(await queued('lead_turn'));
  const { PostgresAdmissionRepository } =
    await import('../../src/infrastructure/postgres/postgres-admission-repository.ts');
  const { PostgresTaskRepository } =
    await import('../../src/infrastructure/postgres/postgres-task-repository.ts');
  const { PostgresRunRepository } =
    await import('../../src/infrastructure/postgres/postgres-run-repository.ts');
  const { PostgresTeamExecutionRepository: FixtureTeamExecutionRepository } =
    await import('../../src/infrastructure/postgres/postgres-collaborative-team-repository.ts');
  const { PostgresTeamMessageRepository: FixtureTeamMessageRepository } =
    await import('../../src/infrastructure/postgres/postgres-team-message-repository.ts');
  const { createChildTask } = await import('../../src/domain/tasks/task.ts');
  const { createRun } = await import('../../src/domain/runs/run.ts');
  const { createTeamMemberRun, activateMemberRun } =
    await import('../../src/domain/teams/team-member-run.ts');
  const { createTeamWorkItem } =
    await import('../../src/domain/teams/team-work-item.ts');
  const { createTeamMessage } =
    await import('../../src/domain/teams/team-message.ts');
  const rootTask = await new PostgresTaskRepository(queryOnly(db)).findById(
    rootTaskId,
  );
  const staleWake = (
    await db.query(
      `SELECT m.id AS message_id,
              a.id AS attempt_id,
              a.attempt_no,
              a.status AS attempt_status,
              a.execution_task_id AS attempt_execution_task_id,
              m.status AS message_status,
              m.consumed_by_task_id AS message_task_id
         FROM team_messages m
         JOIN team_work_item_attempts a ON a.id=m.attempt_id
        WHERE m.team_run_id=$1 AND m.recipient_member_run_id=$2
          AND m.kind='wake'
        ORDER BY m.sequence DESC
        LIMIT 1`,
      [teamRunId, member.id],
    )
  ).rows[0];
  const currentRevision = (
    await db.query('SELECT revision FROM team_runs WHERE id=$1', [teamRunId])
  ).rows[0]?.revision;
  assert(
    rootTask && staleWake && Number.isInteger(currentRevision),
    'stale_materialization_fixture_missing',
  );
  const staleWakeBefore = {
    attemptStatus: staleWake.attempt_status,
    attemptExecutionTaskId: staleWake.attempt_execution_task_id,
    messageStatus: staleWake.message_status,
    messageTaskId: staleWake.message_task_id,
  };
  const staleTask = createChildTask({
    tenantId,
    workspaceId,
    principalType: 'service_account',
    principalId,
    policySnapshotVersion: rootTask.policySnapshotVersion,
    rootTaskId: rootTask.id,
    parentTaskId: rootTask.id,
    parentRunId: (
      await db.query('SELECT root_run_id FROM team_runs WHERE id=$1', [
        teamRunId,
      ])
    ).rows[0].root_run_id,
    invokableKind: 'agent',
    invokableVersionId: member.agent_version_id ?? agents.member,
    inputSnapshotRef: rootTask.inputSnapshotRef,
    inputFingerprint: rootTask.inputFingerprint,
    logicalStepKey: `member:${teamRunId}:${member.id}:stale-revision:${staleWake.attempt_id}`,
    nodePath: `member:${teamRunId}:${member.id}:stale-revision:${staleWake.attempt_id}`,
    teamMemberRunId: member.id,
    teamSequence: staleWake.attempt_no,
    teamTaskKind: 'work_attempt',
    sourceTeamMessageId: staleWake.message_id,
    inputTeamMessageIds: [staleWake.message_id],
  });
  const staleRun = createRun('stale revision materialization smoke');
  let staleRejected = false;
  try {
    await new PostgresAdmissionRepository(queryOnly(db)).withTransaction(
      async (tx) => {
        await tx.tasks.save(staleTask);
        await tx.runs.save(staleRun, { taskId: staleTask.id, attempt: 1 });
        await tx.teamExecutions.materializeAttempt({
          attemptId: staleWake.attempt_id,
          executionTaskId: staleTask.id,
          teamRunId,
          assigneeMemberId: member.id,
          expectedRevision: currentRevision - 1,
          owner,
        });
        await tx.teamMessages.bindToTask({
          messageIds: [staleWake.message_id],
          taskId: staleTask.id,
          owner,
        });
        await tx.enqueueRunDispatch(staleRun.id, staleRun.createdAt);
      },
    );
  } catch (error) {
    staleRejected = error?.code === 'stale_state';
  }
  assert(staleRejected, 'stale_materialization_not_rejected');
  const staleRollback = (
    await db.query(
      `SELECT
         (SELECT count(*)::int FROM tasks WHERE id=$1) AS tasks,
         (SELECT count(*)::int FROM runs WHERE id=$2) AS runs,
         (SELECT count(*)::int FROM run_dispatches WHERE run_id=$2) AS dispatches`,
      [staleTask.id, staleRun.id],
    )
  ).rows[0];
  const staleWakeAfter = (
    await db.query(
      `SELECT a.status AS attempt_status,
              a.execution_task_id AS attempt_execution_task_id,
              m.status AS message_status,
              m.consumed_by_task_id AS message_task_id
         FROM team_work_item_attempts a
         JOIN team_messages m ON m.id=$2 AND m.attempt_id=a.id
        WHERE a.id=$1`,
      [staleWake.attempt_id, staleWake.message_id],
    )
  ).rows[0];
  assert(
    staleRollback.tasks === 0 &&
      staleRollback.runs === 0 &&
      staleRollback.dispatches === 0 &&
      staleWakeAfter?.attempt_status === staleWakeBefore.attemptStatus &&
      staleWakeAfter?.attempt_execution_task_id ===
        staleWakeBefore.attemptExecutionTaskId &&
      staleWakeAfter?.message_status === staleWakeBefore.messageStatus &&
      staleWakeAfter?.message_task_id === staleWakeBefore.messageTaskId,
    'stale_materialization_rollback_invalid',
  );
  marker('STALE_REVISION_MATERIALIZATION_ROLLED_BACK');
  const fixtureExecutions = new FixtureTeamExecutionRepository(queryOnly(db));
  const fixtureMessages = new FixtureTeamMessageRepository(queryOnly(db));
  const memberRunFenceMember = activateMemberRun(
    createTeamMemberRun({
      teamRunId,
      name: `member-run-fence-${suffix}`,
      role: 'member',
      agentVersionId: member.agent_version_id ?? agents.member,
      ...owner,
    }),
  );
  await fixtureExecutions.createMemberRun(memberRunFenceMember);
  const memberRunFenceWork = createTeamWorkItem({
    teamRunId,
    subject: 'terminal task nonterminal run fence fixture',
    description: 'isolated queued wake fixture',
    createdByMemberId: lead.id,
    ...owner,
  });
  await db.query(
    `INSERT INTO team_work_items
       (id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,
        tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [
      memberRunFenceWork.id,
      memberRunFenceWork.teamRunId,
      memberRunFenceWork.subject,
      memberRunFenceWork.description,
      memberRunFenceWork.status,
      memberRunFenceWork.ownerMemberId,
      memberRunFenceWork.createdByMemberId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      memberRunFenceWork.createdAt,
    ],
  );
  const leadTaskId = (
    await db.query(
      `SELECT id FROM tasks
        WHERE root_task_id=$1 AND team_member_run_id=$2
          AND team_task_kind='lead_turn'
        ORDER BY created_at DESC
        LIMIT 1`,
      [rootTaskId, lead.id],
    )
  ).rows[0]?.id;
  assert(leadTaskId, 'member_run_fence_lead_task_missing');
  const memberRunFenceAttemptId = randomUUID();
  const memberRunFenceCreatedAt = new Date().toISOString();
  await db.query(
    `INSERT INTO team_work_item_attempts
       (id,work_item_id,team_run_id,attempt_no,assignee_member_id,
        requested_by_lead_task_id,status,tenant_id,workspace_id,
        principal_type,principal_id,created_at,updated_at)
     VALUES ($1,$2,$3,1,$4,$5,'queued',$6,$7,$8,$9,$10,$10)`,
    [
      memberRunFenceAttemptId,
      memberRunFenceWork.id,
      teamRunId,
      memberRunFenceMember.id,
      leadTaskId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      memberRunFenceCreatedAt,
    ],
  );
  const memberRunFenceWake = await fixtureMessages.create(
    createTeamMessage({
      teamRunId,
      recipientMemberRunId: memberRunFenceMember.id,
      workItemId: memberRunFenceWork.id,
      attemptId: memberRunFenceAttemptId,
      kind: 'wake',
      dedupKey: `member-run-fence:${memberRunFenceAttemptId}`,
      body: 'isolated terminal task nonterminal run fence wake',
      ...owner,
    }),
  );
  const memberRunFenceTask = createChildTask({
    tenantId,
    workspaceId,
    principalType: 'service_account',
    principalId,
    policySnapshotVersion: rootTask.policySnapshotVersion,
    rootTaskId: rootTask.id,
    parentTaskId: rootTask.id,
    parentRunId: (
      await db.query('SELECT root_run_id FROM team_runs WHERE id=$1', [
        teamRunId,
      ])
    ).rows[0].root_run_id,
    invokableKind: 'agent',
    invokableVersionId: memberRunFenceMember.agentVersionId,
    inputSnapshotRef: rootTask.inputSnapshotRef,
    inputFingerprint: rootTask.inputFingerprint,
    logicalStepKey: `member:${teamRunId}:${memberRunFenceMember.id}:all-run-fence`,
    nodePath: `member:${teamRunId}:${memberRunFenceMember.id}:all-run-fence`,
    teamMemberRunId: memberRunFenceMember.id,
  });
  const memberRunFenceRun = createRun('all-run member fence smoke');
  const runRepository = new PostgresRunRepository(queryOnly(db));
  await new PostgresTaskRepository(queryOnly(db)).save(memberRunFenceTask);
  await runRepository.save(memberRunFenceRun, {
    taskId: memberRunFenceTask.id,
    attempt: 1,
  });
  await db.query(
    "UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1",
    [memberRunFenceTask.id],
  );
  const memberRunFenceInitial = (
    await db.query(
      `SELECT w.status AS work_status,
              a.status AS attempt_status,
              a.execution_task_id AS attempt_execution_task_id,
              m.status AS message_status,
              m.consumed_by_task_id AS message_task_id,
              (SELECT count(*)::int
                 FROM team_work_item_dependencies d
                WHERE d.team_run_id=$1 AND d.work_item_id=w.id) AS dependencies,
              (SELECT count(*)::int
                 FROM team_work_item_attempts competing
                WHERE competing.team_run_id=$1
                  AND competing.assignee_member_id=$2
                  AND competing.id<>a.id
                  AND competing.status IN ('queued','running')) AS competing_attempts,
              (SELECT count(*)::int
                 FROM tasks task
                 JOIN runs run ON run.task_id=task.id
                WHERE task.id=$3 AND task.status='completed'
                  AND run.id=$4
                  AND run.status NOT IN ('succeeded','failed','timed_out','cancelled')) AS nonterminal_runs
         FROM team_work_items w
         JOIN team_work_item_attempts a ON a.work_item_id=w.id
         JOIN team_messages m ON m.id=$5 AND m.attempt_id=a.id
        WHERE w.id=$6 AND a.id=$7`,
      [
        teamRunId,
        memberRunFenceMember.id,
        memberRunFenceTask.id,
        memberRunFenceRun.id,
        memberRunFenceWake.id,
        memberRunFenceWork.id,
        memberRunFenceAttemptId,
      ],
    )
  ).rows[0];
  assert(
    memberRunFenceInitial?.work_status === 'pending' &&
      memberRunFenceInitial.attempt_status === 'queued' &&
      memberRunFenceInitial.attempt_execution_task_id === null &&
      memberRunFenceInitial.message_status === 'queued' &&
      memberRunFenceInitial.message_task_id === null &&
      memberRunFenceInitial.dependencies === 0 &&
      memberRunFenceInitial.competing_attempts === 0 &&
      memberRunFenceInitial.nonterminal_runs === 1,
    'terminal_task_nonterminal_run_fixture_invalid',
  );
  assert(
    await runRepository.hasNonterminalRunsForTeamMemberChildTasks(
      rootTaskId,
      [memberRunFenceMember.id],
      owner,
    ),
    'scheduler_all_run_projection_missed_nonterminal_run',
  );
  const memberRunFenceRevision = (
    await db.query('SELECT revision FROM team_runs WHERE id=$1', [teamRunId])
  ).rows[0]?.revision;
  assert(
    Number.isInteger(memberRunFenceRevision),
    'terminal_task_nonterminal_run_revision_missing',
  );
  const memberRunFenceCandidateTask = createChildTask({
    tenantId,
    workspaceId,
    principalType: 'service_account',
    principalId,
    policySnapshotVersion: rootTask.policySnapshotVersion,
    rootTaskId: rootTask.id,
    parentTaskId: rootTask.id,
    parentRunId: (
      await db.query('SELECT root_run_id FROM team_runs WHERE id=$1', [
        teamRunId,
      ])
    ).rows[0].root_run_id,
    invokableKind: 'agent',
    invokableVersionId: memberRunFenceMember.agentVersionId,
    inputSnapshotRef: rootTask.inputSnapshotRef,
    inputFingerprint: rootTask.inputFingerprint,
    logicalStepKey: `member:${teamRunId}:${memberRunFenceMember.id}:wake:${memberRunFenceAttemptId}`,
    nodePath: `member:${teamRunId}:${memberRunFenceMember.id}:wake:${memberRunFenceAttemptId}`,
    teamMemberRunId: memberRunFenceMember.id,
    teamSequence: 1,
    teamTaskKind: 'work_attempt',
    sourceTeamMessageId: memberRunFenceWake.id,
    inputTeamMessageIds: [memberRunFenceWake.id],
  });
  const memberRunFenceCandidateRun = createRun(
    'terminal task nonterminal run fence candidate',
  );
  let memberRunFenceRejected = false;
  try {
    await new PostgresAdmissionRepository(queryOnly(db)).withTransaction(
      async (tx) => {
        await tx.tasks.save(memberRunFenceCandidateTask);
        await tx.runs.save(memberRunFenceCandidateRun, {
          taskId: memberRunFenceCandidateTask.id,
          attempt: 1,
        });
        await tx.teamExecutions.materializeAttempt({
          attemptId: memberRunFenceAttemptId,
          executionTaskId: memberRunFenceCandidateTask.id,
          teamRunId,
          assigneeMemberId: memberRunFenceMember.id,
          expectedRevision: memberRunFenceRevision,
          owner,
        });
        await tx.teamMessages.bindToTask({
          messageIds: [memberRunFenceWake.id],
          taskId: memberRunFenceCandidateTask.id,
          owner,
        });
        await tx.enqueueRunDispatch(
          memberRunFenceCandidateRun.id,
          memberRunFenceCandidateRun.createdAt,
        );
      },
    );
  } catch (error) {
    memberRunFenceRejected = error?.code === 'invalid_transition';
  }
  const memberRunFenceRollback = (
    await db.query(
      `SELECT
         (SELECT count(*)::int FROM tasks WHERE id=$1) AS tasks,
         (SELECT count(*)::int FROM runs WHERE id=$2) AS runs,
         (SELECT count(*)::int FROM run_dispatches WHERE run_id=$2) AS dispatches,
         a.status AS attempt_status,
         a.execution_task_id AS attempt_execution_task_id,
         m.status AS message_status,
         m.consumed_by_task_id AS message_task_id
         FROM team_work_item_attempts a
         JOIN team_messages m ON m.id=$4 AND m.attempt_id=a.id
        WHERE a.id=$3`,
      [
        memberRunFenceCandidateTask.id,
        memberRunFenceCandidateRun.id,
        memberRunFenceAttemptId,
        memberRunFenceWake.id,
      ],
    )
  ).rows[0];
  assert(
    memberRunFenceRejected &&
      memberRunFenceRollback.tasks === 0 &&
      memberRunFenceRollback.runs === 0 &&
      memberRunFenceRollback.dispatches === 0 &&
      memberRunFenceRollback.attempt_status ===
        memberRunFenceInitial.attempt_status &&
      memberRunFenceRollback.attempt_execution_task_id ===
        memberRunFenceInitial.attempt_execution_task_id &&
      memberRunFenceRollback.message_status ===
        memberRunFenceInitial.message_status &&
      memberRunFenceRollback.message_task_id ===
        memberRunFenceInitial.message_task_id,
    'terminal_task_nonterminal_run_admission_fence_invalid',
  );
  await db.query(
    "UPDATE runs SET status='succeeded',fencing_token=1,result=$2::jsonb,updated_at=now() WHERE id=$1",
    [
      memberRunFenceRun.id,
      JSON.stringify({ text: 'all-run member fence terminal' }),
    ],
  );
  assert(
    !(await runRepository.hasNonterminalRunsForTeamMemberChildTasks(
      rootTaskId,
      [memberRunFenceMember.id],
      owner,
    )),
    'scheduler_all_run_projection_remained_nonterminal',
  );
  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM run_dispatches WHERE run_id=$1', [
      memberRunFenceRun.id,
    ]);
    await db.query('DELETE FROM run_events WHERE run_id=$1', [
      memberRunFenceRun.id,
    ]);
    await db.query('DELETE FROM runs WHERE id=$1', [memberRunFenceRun.id]);
    await db.query('DELETE FROM tasks WHERE id=$1', [memberRunFenceTask.id]);
    await db.query('DELETE FROM team_messages WHERE id=$1', [
      memberRunFenceWake.id,
    ]);
    await db.query('DELETE FROM team_work_item_attempts WHERE id=$1', [
      memberRunFenceAttemptId,
    ]);
    await db.query('DELETE FROM team_work_items WHERE id=$1', [
      memberRunFenceWork.id,
    ]);
    await db.query('DELETE FROM team_member_runs WHERE id=$1', [
      memberRunFenceMember.id,
    ]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  const memberRunFenceCleanup = (
    await db.query(
      `SELECT
         (SELECT count(*)::int FROM team_member_runs WHERE id=$1) AS members,
         (SELECT count(*)::int FROM team_work_items WHERE id=$2) AS work_items,
         (SELECT count(*)::int FROM team_work_item_attempts WHERE id=$3) AS attempts,
         (SELECT count(*)::int FROM team_messages WHERE id=$4) AS messages,
         (SELECT count(*)::int FROM tasks WHERE id=$5) AS tasks,
         (SELECT count(*)::int FROM runs WHERE id=$6) AS runs`,
      [
        memberRunFenceMember.id,
        memberRunFenceWork.id,
        memberRunFenceAttemptId,
        memberRunFenceWake.id,
        memberRunFenceTask.id,
        memberRunFenceRun.id,
      ],
    )
  ).rows[0];
  assert(
    memberRunFenceCleanup.members === 0 &&
      memberRunFenceCleanup.work_items === 0 &&
      memberRunFenceCleanup.attempts === 0 &&
      memberRunFenceCleanup.messages === 0 &&
      memberRunFenceCleanup.tasks === 0 &&
      memberRunFenceCleanup.runs === 0,
    'terminal_task_nonterminal_run_fixture_cleanup_invalid',
  );
  marker('TERMINAL_TASK_NONTERMINAL_RUN_FENCES_ENFORCED');
  const blocked = await service.singleRunDebug.rebuildQueuedTeamWakes();
  const blockedAgain = await service.singleRunDebug.rebuildQueuedTeamWakes();
  marker('INDEPENDENT_RECONCILE_COUNTS', {
    blocked,
    blocked_again: blockedAgain,
  });
  assert(blocked === 2 && blockedAgain === 0, 'independent_reconcile_invalid');
  const b = await db.query(
    'SELECT a.status,a.execution_task_id,m.status AS message_status FROM team_work_item_attempts a JOIN team_messages m ON m.attempt_id=a.id WHERE a.team_run_id=$1 AND a.attempt_no=1 AND a.assignee_member_id=$2',
    [teamRunId, observer.id],
  );
  assert(
    b.rowCount === 1 &&
      b.rows[0].status === 'running' &&
      b.rows[0].execution_task_id &&
      b.rows[0].message_status === 'consumed',
    'independent_attempt_not_materialized',
  );
  marker('INDEPENDENT_ATTEMPTS_MATERIALIZED');
  if (failedAttemptMode === 'baseline') {
    service.singleRunDebug.startDispatcher();
    const stranded = await waitFor(
      async () => {
        const team = (
          await db.query(
            'SELECT status,phase,revision,stop_reason FROM team_runs WHERE id=$1',
            [teamRunId],
          )
        ).rows[0];
        const failedAttempt = (
          await db.query(
            `SELECT a.status,a.attempt_no,a.work_item_id,r.status AS run_status,
                    r.error->>'code' AS failure_code,t.status AS task_status
               FROM team_work_item_attempts a
               JOIN tasks t ON t.id=a.execution_task_id
               JOIN runs r ON r.task_id=t.id
              WHERE a.team_run_id=$1 AND a.assignee_member_id=$2
              ORDER BY a.attempt_no DESC LIMIT 1`,
            [teamRunId, member.id],
          )
        ).rows[0];
        const activeChildren = (
          await db.query(
            `SELECT count(*)::int AS count
               FROM tasks t
               LEFT JOIN runs r ON r.task_id=t.id
              WHERE t.root_task_id=$1 AND t.team_task_kind IN ('lead_turn','work_attempt')
                AND (t.status NOT IN ('completed','failed','cancelled')
                     OR (r.id IS NOT NULL AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')))`,
            [rootTaskId],
          )
        ).rows[0]?.count;
        const queuedOrRunningChildren = (
          await db.query(
            `SELECT count(*)::int AS count
               FROM runs r JOIN tasks t ON t.id=r.task_id
              WHERE t.root_task_id=$1 AND t.team_task_kind IN ('lead_turn','work_attempt')
                AND r.status IN ('queued','running')`,
            [rootTaskId],
          )
        ).rows[0]?.count;
        return { team, failedAttempt, activeChildren, queuedOrRunningChildren };
      },
      (state) =>
        state.team?.status === 'active' &&
        state.failedAttempt?.status === 'failed' &&
        state.failedAttempt?.run_status === 'failed' &&
        state.failedAttempt?.failure_code === 'runtime_execution_failed' &&
        ['failed', 'cancelled', 'completed'].includes(
          state.failedAttempt?.task_status,
        ) &&
        state.activeChildren === 0 &&
        state.queuedOrRunningChildren === 0,
      'failed_attempt_stranded_timeout',
    );
    await service.singleRunDebug.stopDispatcher();
    const { PostgresTeamExecutionRepository: BaselineTeamRepository } =
      await import('../../src/infrastructure/postgres/postgres-collaborative-team-repository.ts');
    const recovered = await new BaselineTeamRepository(
      queryOnly(db),
    ).recoverExpiredTeamRuns(new Date().toISOString());
    assert(
      recovered.length === 0,
      'failed_attempt_baseline_recovery_candidate',
    );
    marker('FAILED_ATTEMPT_STRANDED_BASELINE_PROVEN', {
      team_status: stranded.team.status,
      team_phase: stranded.team.phase,
      latest_attempt_status: stranded.failedAttempt.status,
      latest_attempt_code: stranded.failedAttempt.failure_code,
      member_child_task_status: stranded.failedAttempt.task_status,
      member_child_run_status: stranded.failedAttempt.run_status,
      nonterminal_team_child_count: stranded.activeChildren,
      queued_or_running_team_child_count: stranded.queuedOrRunningChildren,
      recover_expired_candidate_count: recovered.length,
    });
    throw new RecoveryComplete();
  }
  const workProof = (
    await db.query(
      'SELECT id FROM team_work_items WHERE team_run_id=$1 ORDER BY created_at,id',
      [teamRunId],
    )
  ).rows;
  assert(workProof.length === 2, 'parallel_work_proof_missing');
  let maxNonterminalLeadTurns = 0;
  let observedMemberOverlap = false;
  let observedIncrementalAcceptance = false;
  const pollParallelism = async () => {
    const leadCount = Number(
      (
        await db.query(
          `SELECT count(*)::int AS count FROM tasks
             WHERE root_task_id=$1 AND team_task_kind='lead_turn'
               AND status NOT IN ('completed','failed','cancelled')`,
          [rootTaskId],
        )
      ).rows[0]?.count ?? 0,
    );
    maxNonterminalLeadTurns = Math.max(maxNonterminalLeadTurns, leadCount);
    assert(leadCount <= 1, 'live_lead_turn_mutex_exceeded');
    const memberRuns = (
      await db.query(
        `SELECT a.work_item_id,r.status,
                min(e.created_at) FILTER (WHERE e.type='started') AS started_at,
                max(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed','cancelled')) AS terminal_at
           FROM team_work_item_attempts a
           JOIN tasks t ON t.id=a.execution_task_id
           JOIN runs r ON r.task_id=t.id
           LEFT JOIN run_events e ON e.run_id=r.id
          WHERE a.team_run_id=$1 GROUP BY a.work_item_id,r.id,r.status`,
        [teamRunId],
      )
    ).rows;
    if (memberRuns.filter((row) => row.status === 'running').length >= 2)
      observedMemberOverlap = true;
    const accept = (
      await db.query(
        `SELECT c.created_at FROM team_command_receipts c
          JOIN runs r ON r.id=c.source_run_id
          JOIN tasks t ON t.id=r.task_id
          WHERE t.root_task_id=$1 AND command_name='team_work_accept'
            AND result_json->>'work_item_id'=$2
          ORDER BY c.created_at LIMIT 1`,
        [rootTaskId, workProof[0].id],
      )
    ).rows[0];
    const work2 = memberRuns.find(
      (row) => row.work_item_id === workProof[1].id,
    );
    if (
      accept &&
      work2?.status &&
      !['succeeded', 'failed', 'timed_out', 'cancelled'].includes(work2.status)
    )
      observedIncrementalAcceptance = true;
  };
  await pollParallelism();
  if (forceStall) {
    marker('FORCED_STALL_DISPATCHER_SKIPPED');
  } else {
    service.singleRunDebug.startDispatcher();
  }
  const terminal = await waitFor(
    async () => {
      await service.singleRunDebug.rebuildQueuedTeamWakes();
      await pollParallelism();
      const row = (
        await db.query('SELECT status,phase FROM team_runs WHERE id=$1', [
          teamRunId,
        ])
      ).rows[0];
      if (row?.status === 'failed') throw new Error('team_terminal_failed');
      if (row?.status === 'cancelled')
        throw new Error('team_terminal_cancelled');
      if (
        row &&
        row.status !== 'active' &&
        row.status !== 'waiting' &&
        row.status !== 'succeeded'
      )
        throw new Error('team_terminal_unsuccessful');
      return row;
    },
    (row) => row?.status === 'succeeded',
    'team_terminal_timeout',
  );
  await service.singleRunDebug.stopDispatcher();
  await pollParallelism();
  assert(terminal.phase === 'done', 'team_phase_not_done');
  if (failedAttemptMode === 'fixed') {
    const terminalFacts = (
      await db.query(
        `SELECT team.status AS team_status,team.stop_reason,
                root_t.status AS root_task_status,root_r.status AS root_run_status,
                count(*) FILTER (WHERE w.status='cancelled')::int AS cancelled_work,
                count(*) FILTER (WHERE w.status NOT IN ('accepted','cancelled'))::int AS nonterminal_work
           FROM team_runs team
           JOIN tasks root_t ON root_t.id=team.root_task_id
           JOIN runs root_r ON root_r.task_id=root_t.id
           JOIN team_work_items w ON w.team_run_id=team.id
          WHERE team.id=$1
          GROUP BY team.status,team.stop_reason,root_t.status,root_r.status`,
        [teamRunId],
      )
    ).rows[0];
    const cancelReceiptCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM team_command_receipts
           WHERE source_run_id IN (SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.root_task_id=$1)
             AND command_name='team_work_cancel'`,
        [rootTaskId],
      )
    ).rows[0]?.count;
    const nonterminalChildren = (
      await db.query(
        `SELECT count(*)::int AS count FROM tasks t
           LEFT JOIN runs r ON r.task_id=t.id
          WHERE t.root_task_id=$1 AND t.team_task_kind IN ('lead_turn','work_attempt')
            AND (t.status NOT IN ('completed','failed','cancelled')
                 OR (r.id IS NOT NULL AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')))`,
        [rootTaskId],
      )
    ).rows[0]?.count;
    assert(
      terminalFacts?.team_status === 'succeeded' &&
        terminalFacts.root_task_status === 'completed' &&
        terminalFacts.root_run_status === 'succeeded' &&
        terminalFacts.stop_reason === 'work_abandoned' &&
        terminalFacts.cancelled_work === 1 &&
        terminalFacts.nonterminal_work === 0 &&
        nonterminalChildren === 0 &&
        scriptedRuntimeInstance?.leadFailureCodeObserved === true &&
        scriptedRuntimeInstance?.cancelReplayEqual === true &&
        cancelReceiptCount === 1,
      'failed_attempt_terminal_path_invalid',
    );
    marker('FAILED_ATTEMPT_TERMINAL_PATH_PROVEN', {
      cancelled_work_count: terminalFacts.cancelled_work,
      team_status: terminalFacts.team_status,
      root_task_status: terminalFacts.root_task_status,
      root_run_status: terminalFacts.root_run_status,
      stop_reason: terminalFacts.stop_reason,
      nonterminal_work_count: terminalFacts.nonterminal_work,
      nonterminal_team_child_count: nonterminalChildren,
      lead_failure_code_observed:
        scriptedRuntimeInstance?.leadFailureCodeObserved
          ? 'runtime_execution_failed'
          : null,
      cancel_replay_equal: scriptedRuntimeInstance?.cancelReplayEqual ?? false,
      cancel_receipt_count: cancelReceiptCount,
    });
    throw new RecoveryComplete();
  }
  const attempts = await db.query(
    'SELECT status,execution_task_id FROM team_work_item_attempts WHERE team_run_id=$1 ORDER BY created_at',
    [teamRunId],
  );
  const terminalAttemptStatuses = new Set(['completed', 'failed']);
  assert(attempts.rowCount >= 2, 'attempt_count_invalid');
  assert(
    attempts.rows.every((row) => row.execution_task_id),
    'attempt_execution_task_missing',
  );
  assert(
    attempts.rows.every((row) => terminalAttemptStatuses.has(row.status)),
    'attempt_status_not_terminal',
  );
  const durableMemberIntervals = (
    await db.query(
      `SELECT a.work_item_id,
              min(e.created_at) FILTER (WHERE e.type='started') AS started_at,
              max(e.created_at) FILTER (WHERE e.type IN ('succeeded','failed','cancelled')) AS terminal_at
         FROM team_work_item_attempts a
         JOIN tasks t ON t.id=a.execution_task_id
         JOIN runs r ON r.task_id=t.id
         JOIN run_events e ON e.run_id=r.id
        WHERE a.team_run_id=$1 GROUP BY a.work_item_id`,
      [teamRunId],
    )
  ).rows;
  const intervalA = durableMemberIntervals.find(
    (row) => row.work_item_id === workProof[0].id,
  );
  const intervalB = durableMemberIntervals.find(
    (row) => row.work_item_id === workProof[1].id,
  );
  assert(
    intervalA?.started_at &&
      intervalA.terminal_at &&
      intervalB?.started_at &&
      intervalB.terminal_at &&
      new Date(intervalA.started_at) < new Date(intervalB.terminal_at) &&
      new Date(intervalB.started_at) < new Date(intervalA.terminal_at),
    'durable_member_intervals_do_not_overlap',
  );
  const durableLeadIntervals = (
    await db.query(
      `SELECT t.team_sequence,t.created_at,t.updated_at
         FROM tasks t
        WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn'
        ORDER BY t.team_sequence`,
      [rootTaskId],
    )
  ).rows;
  for (let index = 1; index < durableLeadIntervals.length; index += 1)
    assert(
      new Date(durableLeadIntervals[index - 1].updated_at) <=
        new Date(durableLeadIntervals[index].created_at),
      'historical_lead_turn_intervals_overlap',
    );
  const acceptA = (
    await db.query(
      `SELECT c.created_at FROM team_command_receipts c
        JOIN runs r ON r.id=c.source_run_id
        JOIN tasks t ON t.id=r.task_id
        WHERE t.root_task_id=$1 AND command_name='team_work_accept'
          AND result_json->>'work_item_id'=$2
        ORDER BY c.created_at LIMIT 1`,
      [rootTaskId, workProof[0].id],
    )
  ).rows[0];
  marker('PARALLEL_INCREMENTAL_DIAGNOSTICS', {
    interval_a: intervalA,
    interval_b: intervalB,
    accept_a_at: acceptA?.created_at,
    observed_member_overlap: observedMemberOverlap,
    observed_incremental_acceptance: observedIncrementalAcceptance,
    max_nonterminal_lead_turns: maxNonterminalLeadTurns,
  });
  assert(maxNonterminalLeadTurns <= 1, 'lead_turn_mutex_history_invalid');
  const incrementalAcceptanceTiming = Boolean(
    acceptA &&
    intervalB?.started_at &&
    intervalB.terminal_at &&
    new Date(intervalB.started_at) < new Date(acceptA.created_at) &&
    new Date(acceptA.created_at) < new Date(intervalB.terminal_at),
  );
  if (observedIncrementalAcceptance && incrementalAcceptanceTiming) {
    marker('PARALLEL_INCREMENTAL_LEAD_PROVEN', {
      max_nonterminal_lead_turns: maxNonterminalLeadTurns,
      member_intervals_overlap: true,
      accepted_work_1_while_work_2_running: true,
    });
  } else {
    marker('PARALLEL_INCREMENTAL_ACCEPTANCE_NOT_OBSERVED', {
      available_timing: Boolean(
        acceptA && intervalB?.started_at && intervalB.terminal_at,
      ),
      observed_incremental_acceptance: observedIncrementalAcceptance,
      timing_match: incrementalAcceptanceTiming,
    });
  }
  const memberSubmittedAttempt = await db.query(
    `SELECT a.status AS attempt_status,r.status AS run_status,m.status AS member_status
       FROM team_work_item_attempts a
       JOIN tasks t ON t.id=a.execution_task_id
       JOIN runs r ON r.task_id=t.id
       JOIN team_member_runs m ON m.id=a.assignee_member_id
      WHERE a.team_run_id=$1 AND a.assignee_member_id=$2`,
    [teamRunId, member.id],
  );
  if (scriptedRuntime) {
    assert(
      memberSubmittedAttempt.rowCount === 1 &&
        memberSubmittedAttempt.rows[0].attempt_status === 'completed' &&
        memberSubmittedAttempt.rows[0].run_status === 'timed_out' &&
        memberSubmittedAttempt.rows[0].member_status === 'idle',
      'submitted_timeout_member_not_idle',
    );
    marker('SUBMITTED_TIMEOUT_ATTEMPT_PRESERVED');
  } else {
    assert(
      memberSubmittedAttempt.rowCount === 1 &&
        memberSubmittedAttempt.rows[0].attempt_status === 'completed' &&
        memberSubmittedAttempt.rows[0].run_status === 'succeeded' &&
        memberSubmittedAttempt.rows[0].member_status === 'idle',
      'paid_member_attempt_not_completed',
    );
    marker('PAID_MEMBER_ATTEMPT_COMPLETED');
  }
  const bCardinality = await db.query(
    "SELECT count(*)::int AS tasks FROM tasks WHERE root_task_id=$1 AND team_member_run_id=$2 AND team_task_kind='work_attempt'",
    [rootTaskId, observer.id],
  );
  assert(
    bCardinality.rows[0].tasks === 1,
    'dependency_attempt_cardinality_invalid',
  );
  const work = await db.query(
    'SELECT id FROM team_work_items WHERE team_run_id=$1 ORDER BY created_at',
    [teamRunId],
  );
  assert(work.rowCount === 2, 'work_count_invalid');
  await expectSqlState(
    'INSERT INTO team_work_item_dependencies(team_run_id,work_item_id,depends_on_work_item_id,tenant_id,workspace_id,principal_type,principal_id) SELECT $1,$2,$2,tenant_id,workspace_id,principal_type,principal_id FROM team_runs WHERE id=$1',
    [teamRunId, work.rows[0].id],
    '23514',
  );
  await db.query(
    'INSERT INTO team_work_item_dependencies(team_run_id,work_item_id,depends_on_work_item_id,tenant_id,workspace_id,principal_type,principal_id) SELECT $1,$2,$3,tenant_id,workspace_id,principal_type,principal_id FROM team_runs WHERE id=$1',
    [teamRunId, work.rows[1].id, work.rows[0].id],
  );
  await expectSqlState(
    'INSERT INTO team_work_item_dependencies(team_run_id,work_item_id,depends_on_work_item_id,tenant_id,workspace_id,principal_type,principal_id) SELECT $1,$2,$3,tenant_id,workspace_id,principal_type,principal_id FROM team_runs WHERE id=$1',
    [teamRunId, work.rows[1].id, work.rows[0].id],
    '23505',
  );
  await db.query(
    'DELETE FROM team_work_item_dependencies WHERE team_run_id=$1 AND work_item_id=$2 AND depends_on_work_item_id=$3',
    [teamRunId, work.rows[1].id, work.rows[0].id],
  );
  await expectSqlState(
    'INSERT INTO team_work_item_dependencies(team_run_id,work_item_id,depends_on_work_item_id,tenant_id,workspace_id,principal_type,principal_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      teamRunId,
      work.rows[0].id,
      work.rows[1].id,
      'foreign',
      workspaceId,
      'service_account',
      principalId,
    ],
    '23503',
  );
  marker('DEPENDENCY_CONSTRAINTS_ENFORCED');
  const { applyDurableKernelMigrations, durableKernelMigrationFilePaths } =
    await import('../../src/infrastructure/postgres/postgres.ts');
  const migration0025 = durableKernelMigrationFilePaths.find((filePath) =>
    filePath.endsWith('0025_agent_team_work_dependencies.sql'),
  );
  assert(migration0025, 'migration_0025_path_missing');
  await db.query(
    "DELETE FROM durable_kernel_schema_migrations WHERE version='0025_agent_team_work_dependencies'",
  );
  await applyDurableKernelMigrations(
    { query: (sql, values) => db.query(sql, values) },
    [migration0025],
  );
  const migrationReplay = await db.query(
    "SELECT count(*)::int AS count FROM durable_kernel_schema_migrations WHERE version='0025_agent_team_work_dependencies'",
  );
  assert(migrationReplay.rows[0].count === 1, 'migration_0025_replay_invalid');
  marker('MIGRATION_0025_CRASH_WINDOW_REPLAYED');
  const { PostgresTeamExecutionRepository } =
    await import('../../src/infrastructure/postgres/postgres-collaborative-team-repository.ts');
  const finishSource = (
    await db.query(
      `SELECT t.completion_requested_by_run_id,r.task_id
         FROM team_runs t JOIN runs r ON r.id=t.completion_requested_by_run_id
        WHERE t.id=$1`,
      [teamRunId],
    )
  ).rows[0];
  assert(
    finishSource?.completion_requested_by_run_id && finishSource.task_id,
    'finish_source_missing',
  );
  await new PostgresTeamExecutionRepository(queryOnly(db)).requestCompletion({
    teamRunId,
    sourceRunId: finishSource.completion_requested_by_run_id,
    leadTaskId: finishSource.task_id,
    commandHash: hash(JSON.stringify(['team_finish', {}])),
    expectedRevision: (
      await db.query('SELECT revision FROM team_runs WHERE id=$1', [teamRunId])
    ).rows[0].revision,
    owner,
  });
  marker('FINISH_RECEIPT_REPLAYED');
  const projection = await request(
    `/api/v1/team-runs:project?root_task_id=${rootTaskId}`,
  );
  const direct = await request(
    `/api/v1/team-runs/${teamRunId}/direct-messages`,
  );
  const memberOriginDirect = await db.query(
    `SELECT count(*)::int AS count FROM team_messages
      WHERE team_run_id=$1 AND kind='direct'
        AND sender_member_run_id=ANY($2::uuid[])`,
    [teamRunId, [member.id, observer.id]],
  );
  assert(
    memberOriginDirect.rows[0].count === 0,
    'member_origin_direct_message_persisted',
  );
  await request(`/api/v1/team-runs/${teamRunId}/direct-messages`, {
    status: 404,
    authToken: foreignToken,
  });
  await request(`/api/v1/team-runs/${teamRunId}`, {
    status: 404,
    authToken: foreignToken,
  });
  const replay = await request(
    `/api/v1/team-runs:project?root_task_id=${rootTaskId}`,
  );
  assert(
    projection.project?.phase === 'done' &&
      projection.work_items?.length === 2 &&
      projection.gates?.finish_ready === true &&
      projection.sessions?.find((session) => session.name === 'member')
        ?.status === 'idle' &&
      direct.length === 1 &&
      JSON.stringify(projection) === JSON.stringify(replay),
    'safe_projection_or_replay_invalid',
  );
  assertProjectionScannerSelfCheck();
  assertSafeProjection(projection);
  assert(Array.isArray(projection.sessions), 'sessions_projection_missing');
  const runtimeSessions = await db.query(
    `SELECT id,name,role,runtime_session_id
       FROM team_member_runs WHERE team_run_id=$1 ORDER BY name`,
    [teamRunId],
  );
  assert(
    runtimeSessions.rowCount === 3 &&
      runtimeSessions.rows.every((row) => row.runtime_session_id),
    'runtime_session_link_missing',
  );
  const leadTaskBindings = await db.query(
    `SELECT DISTINCT rs.id,rs.provider_agent_id,rs.paseo_workspace_id,rs.task_id,
            sls.workspace_id,sls.tool_refs
       FROM runtime_sessions rs
       JOIN tasks t ON t.id=rs.task_id
       JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
      WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn'
        AND rs.scope_kind='team_member' AND rs.scope_id=$2`,
    [rootTaskId, lead.id],
  );
  assert(
    leadTaskBindings.rowCount === 1 &&
      leadTaskBindings.rows[0].provider_agent_id &&
      leadTaskBindings.rows[0].paseo_workspace_id,
    'lead_task_provider_bindings_invalid',
  );
  const teamChildRuns = await db.query(
    `SELECT r.id,t.team_task_kind,t.team_member_run_id
       FROM tasks t JOIN runs r ON r.task_id=t.id
      WHERE t.root_task_id=$1 AND t.team_task_kind IN ('lead_turn','work_attempt')`,
    [rootTaskId],
  );
  const leadRunIds = new Set(
    teamChildRuns.rows
      .filter((row) => row.team_task_kind === 'lead_turn')
      .map((row) => row.id),
  );
  const memberRunIds = new Set(
    teamChildRuns.rows
      .filter((row) => row.team_task_kind === 'work_attempt')
      .map((row) => row.id),
  );
  const leadControlProgress = await db.query(
    `SELECT t.team_sequence,array_agg(c.command_name ORDER BY c.created_at,c.command_name) AS commands
       FROM tasks t
       JOIN runs r ON r.task_id=t.id
       JOIN team_command_receipts c ON c.source_run_id=r.id
      WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn'
        AND c.command_name=ANY($2::text[])
      GROUP BY t.team_sequence ORDER BY t.team_sequence`,
    [
      rootTaskId,
      [
        'team_work_create',
        'team_work_accept',
        'team_work_request_changes',
        'team_finish',
      ],
    ],
  );
  assert(
    leadControlProgress.rowCount === 4 &&
      JSON.stringify(
        leadControlProgress.rows.map((row) => row.team_sequence),
      ) === JSON.stringify([1, 2, 3, 4]) &&
      leadControlProgress.rows[0].commands.filter(
        (command) => command === 'team_work_create',
      ).length === 2 &&
      leadControlProgress.rows[1].commands.includes('team_work_accept') &&
      leadControlProgress.rows[2].commands.includes('team_work_accept') &&
      leadControlProgress.rows[3].commands.includes('team_finish'),
    'lead_canonical_progress_receipts_invalid',
  );
  marker('LEAD_CANONICAL_PROGRESS_PROVEN');
  const directRunIds = new Set(
    (
      await db.query(
        `SELECT r.id FROM tasks t JOIN runs r ON r.task_id=t.id
          WHERE t.root_task_id=$1 AND t.team_task_kind='direct_message'`,
        [rootTaskId],
      )
    ).rows.map((row) => row.id),
  );
  const directTask = await db.query(
    `SELECT t.id AS task_id,r.id AS run_id,r.updated_at AS run_updated_at,t.team_task_kind,t.team_member_run_id,
            t.source_team_message_id,t.input_team_message_ids,t.team_sequence,
            r.status AS run_status,m.status AS message_status,m.body
       FROM tasks t
       JOIN runs r ON r.task_id=t.id
       JOIN team_messages m ON m.id=t.source_team_message_id
      WHERE t.root_task_id=$1 AND t.team_task_kind='direct_message'`,
    [rootTaskId],
  );
  assert(
    directTask.rowCount === 1 &&
      directTask.rows[0].team_member_run_id === observer.id &&
      directTask.rows[0].team_task_kind === 'direct_message' &&
      directTask.rows[0].message_status === 'delivered' &&
      directTask.rows[0].input_team_message_ids?.length === 1 &&
      String(directTask.rows[0].body).includes('phase3-direct-sentinel') &&
      !String(directTask.rows[0].body).includes('canary-secret') &&
      !String(directTask.rows[0].body).includes('/Users/canary'),
    'direct_production_reconcile_invalid',
  );
  marker('DIRECT_MCP_QUEUED_AND_PRODUCTION_RECONCILED');
  const leadAfterDirect = await db.query(
    `SELECT created_at FROM tasks
      WHERE root_task_id=$1 AND team_task_kind='lead_turn' AND team_sequence=4`,
    [rootTaskId],
  );
  assert(
    leadAfterDirect.rowCount === 1 &&
      Date.parse(leadAfterDirect.rows[0].created_at) >=
        Date.parse(directTask.rows[0].run_updated_at),
    'lead_scheduled_before_direct_terminal',
  );
  marker('DIRECT_LEAD_DEFERRED_UNTIL_DELIVERED');
  assert(
    leadRunIds.size === 4 && memberRunIds.size === 2,
    'team_child_run_cardinality_invalid',
  );
  let paidLeadRuntimeEvidence = {};
  if (scriptedRuntime) {
    const bindings = runtimeCalls.filter(
      (call) => call.kind === 'runtime_binding',
    );
    const leadBindings = bindings.filter((call) => call.role === 'lead');
    assert(
      leadBindings.length === 4 &&
        leadBindings[0].operation === 'create' &&
        leadBindings.slice(1).every((call) => call.operation === 'continue') &&
        new Set(leadBindings.map((call) => call.provider_binding_hash)).size ===
          1,
      'scripted_lead_member_runtime_not_reused',
    );
    const directBindings = bindings.filter((call) => call.role === 'direct');
    const observerBindings = bindings.filter(
      (call) => call.role === 'member' && call.operation === 'create',
    );
    assert(
      directBindings.length === 1 &&
        directBindings[0].operation === 'continue' &&
        runtimeCalls.some(
          (call) =>
            call.role === 'direct' &&
            call.observed_sentinel &&
            call.acknowledged,
        ) &&
        observerBindings.length >= 1 &&
        observerBindings.some(
          (call) =>
            call.provider_binding_hash ===
            directBindings[0].provider_binding_hash,
        ),
      'direct_runtime_session_not_continued',
    );
    const scriptedLeadTurns = runtimeCalls.filter(
      (call) =>
        call.role === 'lead' &&
        Number.isInteger(call.turn) &&
        !call.idle_same_client_rejected &&
        !call.forbidden_rejected,
    );
    const scriptedMemberTurns = runtimeCalls.filter(
      (call) => call.role === 'member' && Number.isInteger(call.turn),
    );
    assert(
      scriptedLeadTurns.length === 4 &&
        scriptedMemberTurns.length === 2 &&
        scriptedLeadTurns.every((call, index) => call.turn === index + 1) &&
        scriptedMemberTurns.every((call, index) => call.turn === index + 1),
      'scripted_golden_path_turn_cardinality_invalid',
    );
  } else {
    const created = runtimeTrace.filter(
      (event) => event.event === 'runtime.agent.create.completed',
    );
    const sent = runtimeTrace.filter(
      (event) => event.event === 'runtime.message.send.completed',
    );
    const leadCreates = created.filter((event) => leadRunIds.has(event.runId));
    const leadPromptSends = sent.filter((event) => leadRunIds.has(event.runId));
    assert(
      leadCreates.length === 1 &&
        leadPromptSends.length === 4 &&
        created.filter((event) => memberRunIds.has(event.runId)).length === 2 &&
        sent.filter((event) => memberRunIds.has(event.runId)).length === 2,
      'paid_lead_task_runtime_evidence_invalid',
    );
    paidLeadRuntimeEvidence = {
      lead_provider_create_executions: leadCreates.length,
      lead_provider_prompt_send_completions: leadPromptSends.length,
      lead_persisted_provider_bindings: new Set(
        leadTaskBindings.rows.map((row) => row.provider_agent_id),
      ).size,
    };
  }
  marker('SAFE_PROJECTION_AND_RUNTIME_BINDINGS', {
    member_binding_hashes: runtimeSessions.rows
      .filter((row) => row.role !== 'lead')
      .map((row) => hash(row.runtime_session_id)),
    lead_binding_hashes: leadTaskBindings.rows.map((row) =>
      hash(row.provider_agent_id),
    ),
    ...paidLeadRuntimeEvidence,
    lead_turns: leadRunIds.size,
    member_attempt_runs: memberRunIds.size,
  });
  const leadRows = await db.query(
    `SELECT t.id AS task_id,r.id AS run_id,r.status,t.team_sequence
       FROM tasks t JOIN runs r ON r.task_id=t.id
      WHERE t.root_task_id=$1 AND t.team_task_kind='lead_turn'
      ORDER BY t.team_sequence`,
    [rootTaskId],
  );
  assert(leadRows.rowCount === 4, 'lead_task_run_count_invalid');
  const leadTaskHashes = leadRows.rows.map((row) => hash(row.task_id));
  const leadRunHashes = leadRows.rows.map((row) => hash(row.run_id));
  const contextEpochHashes = leadRows.rows.map((row) =>
    hash(`${row.task_id}:${row.run_id}`),
  );
  assert(
    new Set(leadTaskHashes).size === 4 &&
      new Set(leadRunHashes).size === 4 &&
      new Set(contextEpochHashes).size === 4,
    'lead_task_run_context_epoch_distinct_invalid',
  );
  const leadSession = leadTaskBindings.rows[0];
  const canonicalLeadRefs = [
    'agent-server/team-state',
    'agent-server/team-work-list',
    'agent-server/team-message-send',
    'agent-server/team-work-create',
    'agent-server/team-work-accept-v2',
    'agent-server/team-work-cancel',
    'agent-server/team-work-request-changes',
    'agent-server/team-finish',
  ];
  assert(
    leadSession.task_id === leadRows.rows[0].task_id &&
      sameUniqueRefs(leadSession.tool_refs, canonicalLeadRefs),
    'lead_session_creating_task_or_catalog_invalid',
  );
  marker('PERSISTENT_LEAD_ACCEPTANCE', {
    lead_runtime_session_distinct: 1,
    lead_provider_agent_distinct: 1,
    lead_paseo_workspace_distinct: 1,
    lead_task_count: leadRows.rowCount,
    lead_run_count: new Set(leadRunHashes).size,
    lead_context_epoch_count: new Set(contextEpochHashes).size,
    max_nonterminal_lead_turns: maxNonterminalLeadTurns,
    lead_provider_create: scriptedRuntime
      ? 1
      : paidLeadRuntimeEvidence.lead_provider_create_executions,
    lead_prompt_sends_or_continues: 4,
    lead_creating_task_matches_first: true,
    lead_catalog_exact_eight: true,
  });
  const deliveredDirect = await db.query(
    `SELECT m.status,m.consumed_by_task_id,t.id AS task_id,r.id AS run_id,r.status AS run_status
       FROM team_messages m
       JOIN tasks t ON t.id=m.consumed_by_task_id
       JOIN runs r ON r.task_id=t.id
      WHERE m.team_run_id=$1 AND m.kind='direct'`,
    [teamRunId],
  );
  assert(
    deliveredDirect.rowCount === 1 &&
      deliveredDirect.rows[0].status === 'delivered' &&
      deliveredDirect.rows[0].task_id === directTask.rows[0].task_id &&
      deliveredDirect.rows[0].run_status === 'succeeded' &&
      directRunIds.has(deliveredDirect.rows[0].run_id ?? ''),
    'direct_delivery_linkage_invalid',
  );
  marker('DIRECT_DELIVERED_AND_CONTINUED');
  const rootRunState = await db.query(
    'SELECT t.status AS task_status,r.status AS run_status FROM tasks t JOIN runs r ON r.task_id=t.id WHERE t.id=$1',
    [rootTaskId],
  );
  assert(
    rootRunState.rows[0].task_status === 'completed' &&
      rootRunState.rows[0].run_status === 'succeeded',
    'root_not_terminal',
  );
  const nonterminalMemberChildren = await db.query(
    `SELECT count(*)::int AS count
       FROM tasks task
       JOIN team_member_runs member
         ON member.id=task.team_member_run_id
        AND member.team_run_id=$1 AND member.role='member'
       LEFT JOIN runs run ON run.task_id=task.id
      WHERE task.root_task_id=$2
        AND (
          task.status NOT IN ('completed','failed','cancelled')
          OR (run.id IS NOT NULL AND run.status NOT IN ('succeeded','failed','timed_out','cancelled'))
        )`,
    [teamRunId, rootTaskId],
  );
  assert(
    nonterminalMemberChildren.rows[0].count === 0,
    'nonterminal_member_child_remaining',
  );
  marker('COMPLETION_MEMBER_CHILD_FENCE_ENFORCED');
  const finalMessageFacts = (
    await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE kind='direct')::int AS direct
         FROM team_messages WHERE team_run_id=$1`,
      [teamRunId],
    )
  ).rows[0];
  marker('RESULT_PASS', {
    expected: { terminal: true, direct: true, dependency: true, replay: true },
    actual: { terminal: true, direct: true, dependency: true, replay: true },
    durable_cardinality: {
      team_members: roster.rowCount,
      work_items: work.rowCount,
      attempts: attempts.rowCount,
      team_messages: finalMessageFacts.total,
      direct_messages: finalMessageFacts.direct,
      lead_turns: leadRunIds.size,
      member_attempt_runs: memberRunIds.size,
    },
  });
  if (scriptedRuntime) await scriptedRuntimeInstance.assertLeadIdle();
  await evidence('passed');
} catch (error) {
  if (error instanceof RecoveryComplete) {
    await evidence('passed');
  } else {
    const failure = smokeFailure(error);
    try {
      await collectFailureDiagnostic(failure);
      await evidence('blocked', failure);
    } catch {
      process.stderr.write('SMOKE_EVIDENCE_WRITE_FAILED\n');
    }
    throw failure;
  }
} finally {
  if (!expiredLeaseRecovery)
    await service?.singleRunDebug?.stopDispatcher?.().catch(() => undefined);
  await new Promise((done) => api?.close?.(() => done()) ?? done()).catch(
    () => undefined,
  );
  await service?.close?.().catch(() => undefined);
  await (paseo?.child ? stopProcessTree(paseo.child) : Promise.resolve()).catch(
    () => undefined,
  );
  await db?.end?.().catch(() => undefined);
  await admin?.end?.().catch(() => undefined);
}
