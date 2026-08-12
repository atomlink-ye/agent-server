import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register as registerTsx } from 'tsx/esm/api';
import { recordProductLineageGolden } from './product-lineage-golden-recorder.mjs';

registerTsx();

const { TEAM_LEAD_CONTROL_PROTOCOL } =
  await import('../../src/application/context/runtime-prompts.ts');
const { ProductRunTraceResponseSchema, ProductWorkRunResponseSchema } =
  await import('../../src/contracts/product-projection/index.ts');

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
const reworkScenario = process.env.AGENT_TEAMS_V2_SMOKE_REWORK === '1';
const productWorkDurableIdentity =
  process.env.PRODUCT_WORK_DURABLE_IDENTITY === '1';
const expiredLeaseRecovery =
  process.env.AGENT_TEAMS_V2_SMOKE_EXPIRED_LEASE_RECOVERY ?? '';
const scriptedRuntime =
  requestedScriptedRuntime || Boolean(expiredLeaseRecovery);
const requestedProvider = process.env.PASEO_PROVIDER ?? 'opencode';
const supportedSmokeModels = {
  opencode: new Set([
    'opencode-go/deepseek-v4-flash',
    'opencode-go/mimo-v2.5',
    'opencode-go/glm-5.2',
  ]),
  claude: new Set(['deepseek-v4-flash']),
  codex: new Set(['deepseek-v4-flash']),
};
if (!['', 'lead', 'members'].includes(expiredLeaseRecovery))
  throw new Error('invalid_expired_lease_recovery');
if (!['', 'baseline', 'fixed'].includes(failedAttemptMode))
  throw new Error('invalid_failed_attempt_mode');
if (reworkScenario && (failedAttemptMode || expiredLeaseRecovery))
  throw new Error('rework_scenario_mode_conflict');
const requestedModel =
  process.env.PASEO_MODEL ??
  (requestedProvider === 'opencode' ? 'opencode-go/deepseek-v4-flash' : '');
const runtimeResolutionProviders = new Set(['opencode', 'claude', 'codex']);
const anthropicEnvironmentVariableNames = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
];
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
const canonicalTeamMcpNames = new Set([
  'team_state',
  'team_work_list',
  'team_work_create',
  'team_work_request_changes',
  'team_work_cancel',
  'team_work_accept',
  'team_finish',
  'team_work_checkpoint',
  'team_work_submit',
  'team_message_send',
]);
const fixtureNames = Object.freeze({
  lead: 'research-lead',
  member: 'opportunity-analyst',
  observer: 'risk-reviewer',
});
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
let runtimeResolutionEvidence;
class RecoveryComplete extends Error {}
let scriptedRuntimeInstance;

const envelopePattern =
  /^\[agent-server · team:([^\s\]]+) · to:([^\s\]]+) · kind:(wake|direct|rework|lead_turn) · from:([^\s\]]+) · seq:([1-9][0-9]*)\]$/u;

function countOccurrences(value, needle) {
  if (!value || !needle) return 0;
  return value.split(needle).length - 1;
}

function transcriptEvidenceFacts(rows) {
  const authenticationFailurePattern =
    /not logged in|401\s+unauthorized|missing\s+bearer|authentication\s+required/iu;
  const membersWithTranscript = new Set();
  let authenticationFailureEvents = 0;
  for (const row of rows) {
    const serializedText = JSON.stringify(row.payload);
    if (authenticationFailurePattern.test(serializedText))
      authenticationFailureEvents += 1;
    membersWithTranscript.add(row.team_member_run_id);
  }
  return {
    membersWithTranscriptCount: membersWithTranscript.size,
    outputEventCount: rows.length,
    authenticationFailureEvents,
  };
}

function assertPaidTranscriptEvidence(rows, expectedMemberCount) {
  const facts = transcriptEvidenceFacts(rows);
  assert(
    expectedMemberCount > 0 &&
      facts.membersWithTranscriptCount === expectedMemberCount &&
      facts.authenticationFailureEvents === 0,
    'paid_transcript_acceptance_invalid',
  );
  marker('PAID_TRANSCRIPT_ACCEPTANCE', {
    transcript_evidence: true,
    member_count: expectedMemberCount,
    members_with_transcript: facts.membersWithTranscriptCount,
    output_event_count: facts.outputEventCount,
    authentication_failure_events: facts.authenticationFailureEvents,
  });
}

function decodeEnvelopeAtom(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`control_plane_envelope_${label}_encoding_invalid`);
  }
}

function decodePromptSnapshot(snapshotRef) {
  const prefix = 'inline:run-request:';
  assert(
    typeof snapshotRef === 'string' && snapshotRef.startsWith(prefix),
    'control_plane_snapshot_ref_invalid',
  );
  const parsed = JSON.parse(
    Buffer.from(snapshotRef.slice(prefix.length), 'base64url').toString('utf8'),
  );
  assert(
    typeof parsed.prompt === 'string',
    'control_plane_snapshot_prompt_missing',
  );
  return parsed.prompt;
}

async function capturePersistedControlPlaneEnvelopeEvidence() {
  if (!db || !rootTaskId || !teamRunId) return [];
  const rows = (
    await db.query(
      `SELECT t.team_task_kind,t.team_sequence,t.input_snapshot_ref,m.name,m.role
         FROM tasks t
         LEFT JOIN team_member_runs m ON m.id=t.team_member_run_id
        WHERE t.root_task_id=$1 AND t.team_task_kind IN ('lead_turn','work_attempt','direct_message')
        ORDER BY t.created_at,t.id`,
      [rootTaskId],
    )
  ).rows;
  const firstEnvelopeLines = [];
  let persistedLeadUserProtocolOccurrences = 0;
  for (const row of rows) {
    const prompt = decodePromptSnapshot(row.input_snapshot_ref);
    if (row.team_task_kind === 'lead_turn') {
      persistedLeadUserProtocolOccurrences += countOccurrences(
        prompt,
        TEAM_LEAD_CONTROL_PROTOCOL,
      );
      assert(
        !prompt.includes(TEAM_LEAD_CONTROL_PROTOCOL),
        'persisted_lead_control_protocol_in_user_prompt',
      );
    }
    const firstLine = prompt.split('\n', 1)[0];
    const match = envelopePattern.exec(firstLine);
    assert(match, 'persisted_control_plane_envelope_missing_or_unanchored');
    const [, team, recipientEncoded, kind, senderEncoded, sequenceText] = match;
    const recipient = decodeEnvelopeAtom(recipientEncoded, 'recipient');
    const sender = decodeEnvelopeAtom(senderEncoded, 'sender');
    const sequence = Number(sequenceText);
    const expectedKind =
      row.team_task_kind === 'lead_turn'
        ? 'lead_turn'
        : row.team_task_kind === 'direct_message'
          ? 'direct'
          : prompt.includes('Attempt number: 2')
            ? 'rework'
            : 'wake';
    const expectedRecipient =
      row.team_task_kind === 'lead_turn' ? fixtureNames.lead : row.name;
    const expectedSender =
      row.team_task_kind === 'lead_turn' ? 'agent-server' : fixtureNames.lead;
    const expectedSequence = row.team_sequence;
    assert(
      team === teamRunId.slice(0, 8) &&
        kind === expectedKind &&
        recipient === expectedRecipient &&
        sender === expectedSender &&
        Number.isSafeInteger(sequence) &&
        sequence > 0 &&
        sequence === expectedSequence &&
        prompt.includes(
          'The authoritative current state is available through agent-server tools.',
        ) &&
        !prompt.includes('<system>'),
      'persisted_control_plane_envelope_values_invalid',
    );
    firstEnvelopeLines.push(firstLine);
  }
  marker('CONTROL_PLANE_DURABLE_ENVELOPE_EVIDENCE', {
    first_envelope_lines: firstEnvelopeLines,
    delivery_count: firstEnvelopeLines.length,
    persisted_lead_user_protocol_occurrences:
      persistedLeadUserProtocolOccurrences,
  });
  return firstEnvelopeLines;
}

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
      const isProjectedTurnProvider =
        normalized === 'provider' &&
        /^projection\.sessions\[[0-9]+\]\.turns\[[0-9]+\]\.provider$/u.test(
          `${path}.${key}`,
        );
      assert(
        isProjectedTurnProvider ||
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
  assertSafeProjection({ sessions: [{ turns: [{ provider: 'x' }] }] });
  for (const [label, value] of [
    ['camel_key', { runtimeSessionId: 'x' }],
    ['snake_key', { runtime_session_id: 'x' }],
    ['bearer', { note: 'Bearer leaked-value' }],
    ['key_value', { note: 'token=leaked-value' }],
    ['path', { note: '/Volumes/private' }],
    ['canary', { note: 'canary-secret' }],
    ['provider', { provider: 'x' }],
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
// Product trace acceptance artifacts are already schema-validated and must
// retain their real identity/pointer fields for the remote acceptance log.
function markerRaw(name, fields = {}) {
  const entry = { marker: name, at: new Date().toISOString(), ...fields };
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
    ...(runtimeResolutionEvidence
      ? { runtime_resolution_artifact: 'runtime-resolution.json' }
      : {}),
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
  if (runtimeResolutionEvidence) {
    const target = join(evidenceRoot, 'runtime-resolution.json');
    const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(
      temp,
      `${JSON.stringify(runtimeResolutionEvidence, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    await rename(temp, target);
    await chmod(target, 0o600);
  }
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
                r.error->>'code' AS run_error_code,
                r.runtime->>'provider' AS runtime_provider,
                r.runtime->>'model' AS runtime_model,
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
      run_error_code: row.run_error_code ?? null,
      runtime_provider: row.runtime_provider ?? null,
      runtime_model: row.runtime_model ?? null,
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
async function proveRuntimeResolution() {
  const rows = (
    await db.query(
      `SELECT m.name AS member_name,
              m.role,
              m.agent_version_id::text AS agent_version_ref,
              av.policy_snapshot->>'modelPolicyRef' AS model_policy_ref,
              r.runtime->>'provider' AS provider,
              r.runtime->>'model' AS model,
              count(*)::int AS run_count
         FROM team_runs tr
         JOIN team_member_runs m ON m.team_run_id=tr.id
         JOIN agent_versions av ON av.id=m.agent_version_id
         JOIN tasks t
           ON t.team_member_run_id=m.id
          AND t.root_task_id=tr.root_task_id
         JOIN runs r ON r.task_id=t.id
        WHERE tr.id=$1
          AND r.status='succeeded'
        GROUP BY m.name,m.role,m.agent_version_id,av.policy_snapshot,
                 r.runtime->>'provider',r.runtime->>'model'
        ORDER BY m.name,r.runtime->>'provider',r.runtime->>'model'`,
      [teamRunId],
    )
  ).rows;
  const normalizeRuntimeValue = (value) => {
    if (value === null || value === undefined) return null;
    return String(value)
      .replace(/[^\x20-\x7e]/gu, '?')
      .slice(0, 200);
  };
  const resolvedRows = rows.map((row) => {
    const provider = normalizeRuntimeValue(row.provider);
    const model = normalizeRuntimeValue(row.model);
    return {
      member_name: normalizeRuntimeValue(row.member_name),
      role: normalizeRuntimeValue(row.role),
      agent_version_ref: normalizeRuntimeValue(row.agent_version_ref),
      model_policy_ref: normalizeRuntimeValue(row.model_policy_ref),
      provider,
      model,
      run_count: Number(row.run_count),
    };
  });
  const byName = new Map(resolvedRows.map((row) => [row.member_name, row]));
  const lead = byName.get(fixtureNames.lead);
  const member = byName.get(fixtureNames.member);
  const observer = byName.get(fixtureNames.observer);
  const distinctProviders = new Set(resolvedRows.map((row) => row.provider));
  const exactMappings =
    lead?.role === 'lead' &&
    lead.model_policy_ref === 'free-only' &&
    lead.provider === requestedProvider &&
    lead.model === requestedModel &&
    member?.role === 'member' &&
    member.model_policy_ref === 'claude/deepseek-v4-flash' &&
    member.provider === 'claude' &&
    member.model === 'deepseek-v4-flash' &&
    observer?.role === 'member' &&
    observer.model_policy_ref === 'codex/deepseek-v4-flash' &&
    observer.provider === 'codex' &&
    observer.model === 'deepseek-v4-flash';
  runtimeResolutionEvidence = {
    schema: 'agent-teams-v2-runtime-resolution-v2',
    durable_query: true,
    durable_rows: resolvedRows,
    requested_provider: requestedProvider,
    requested_model: requestedModel,
    member_count: resolvedRows.length,
    distinct_provider_count: distinctProviders.size,
    exact_mappings: exactMappings,
  };
  assert(resolvedRows.length === 3, 'runtime_resolution_member_count_invalid');
  assert(
    new Set(resolvedRows.map((row) => row.member_name)).size === 3 &&
      resolvedRows.every(
        (row) => Number.isInteger(row.run_count) && row.run_count > 0,
      ),
    'runtime_resolution_member_cardinality_invalid',
  );
  assert(
    distinctProviders.size === 3,
    'runtime_resolution_provider_count_invalid',
  );
  assert(exactMappings, 'runtime_resolution_mismatch');
  marker('RUNTIME_RESOLUTION_PROVEN', {
    durable_query: true,
    durable_rows: resolvedRows,
    member_count: resolvedRows.length,
    distinct_provider_count: distinctProviders.size,
    runtime_resolution_equal: true,
  });
}
async function captureS3S4TimeoutEvidence() {
  await proveRuntimeResolution();
  const projection = await request(
    `/api/v1/team-runs:project?root_task_id=${rootTaskId}`,
  );
  assert(Array.isArray(projection.work_items), 's3_s4_work_items_missing');
  assert(projection.work_items.length > 0, 's3_s4_work_items_empty');
  const expectedAttemptKeys = [
    'attempt_no',
    'status',
    'feedback_summary',
    'result_summary',
  ].sort();
  let projectedAttemptCount = 0;
  for (const item of projection.work_items) {
    assert(
      Object.hasOwn(item, 'description') && Array.isArray(item.attempts),
      's3_s4_work_item_shape_invalid',
    );
    assert(
      item.description === null || typeof item.description === 'string',
      's3_s4_work_item_description_invalid',
    );
    projectedAttemptCount += item.attempts.length;
    for (const attempt of item.attempts) {
      assert(
        expectedAttemptKeys.every((key) => Object.hasOwn(attempt, key)) &&
          Number.isInteger(attempt.attempt_no) &&
          attempt.attempt_no > 0 &&
          ['queued', 'running', 'completed', 'failed'].includes(
            attempt.status,
          ) &&
          (attempt.feedback_summary === null ||
            typeof attempt.feedback_summary === 'string') &&
          (attempt.result_summary === null ||
            typeof attempt.result_summary === 'string'),
        's3_s4_attempt_shape_invalid',
      );
    }
  }
  assert(projectedAttemptCount > 0, 's3_s4_attempts_empty');
  assert(Array.isArray(projection.sessions), 's3_s4_sessions_missing');
  const projectedTurns = projection.sessions.flatMap((session) =>
    Array.isArray(session.turns) ? session.turns : [],
  );
  const projectedTurnIds = projectedTurns.map((turn) => turn.run_id);
  assert(
    projectedTurnIds.length > 0 &&
      projectedTurnIds.every((runId) => typeof runId === 'string'),
    's3_s4_projected_turns_missing',
  );
  const projectedRuntimeRows = (
    await db.query('SELECT id,runtime FROM runs WHERE id=ANY($1::uuid[])', [
      projectedTurnIds,
    ])
  ).rows;
  const runtimeByRunId = new Map(
    projectedRuntimeRows.map((row) => [row.id, row.runtime]),
  );
  const runtimeProjectionExact =
    projectedRuntimeRows.length === new Set(projectedTurnIds).size &&
    projectedTurns.every((turn) => {
      const runtime = runtimeByRunId.get(turn.run_id);
      return (
        runtime &&
        Object.hasOwn(turn, 'provider') &&
        Object.hasOwn(turn, 'model') &&
        turn.provider === runtime.provider &&
        turn.model === runtime.model
      );
    });
  assert(runtimeProjectionExact, 's3_s4_projected_runtime_mismatch');
  const runtimeLabels = new Set(
    projectedTurns.map((turn) => `${turn.provider}/${turn.model}`),
  );
  const expectedRuntimeLabels = [
    `${requestedProvider}/${requestedModel}`,
    'claude/deepseek-v4-flash',
    'codex/deepseek-v4-flash',
  ];
  assert(
    expectedRuntimeLabels.every((label) => runtimeLabels.has(label)),
    's3_s4_runtime_label_set_invalid',
  );
  const team = (
    await db.query(
      'SELECT status,stop_reason,revision FROM team_runs WHERE id=$1',
      [teamRunId],
    )
  ).rows[0];
  assert(
    ['active', 'waiting'].includes(team?.status) &&
      team.stop_reason === null &&
      Number.isInteger(team.revision) &&
      team.revision > 0,
    's3_s4_team_not_absorbing_active',
  );
  assert(
    projection.project &&
      Object.hasOwn(projection.project, 'stop_reason') &&
      projection.project.stop_reason === null &&
      Number.isInteger(projection.project.revision) &&
      projection.project.revision > 0,
    's3_s4_project_terminal_metadata_invalid',
  );
  const succeededWorkAttemptRuns = (
    await db.query(
      `SELECT r.id,
              EXISTS (
                SELECT 1 FROM team_command_receipts receipt
                 WHERE receipt.source_run_id=r.id
                   AND receipt.command_name='team_work_submit'
              ) AS has_submit_receipt
         FROM runs r
         JOIN tasks t ON t.id=r.task_id
        WHERE t.root_task_id=$1
          AND t.team_task_kind='work_attempt'
          AND r.status='succeeded'
        ORDER BY r.id`,
      [rootTaskId],
    )
  ).rows;
  const succeededWithoutSubmit = succeededWorkAttemptRuns.filter(
    (row) => !row.has_submit_receipt,
  ).length;
  assert(
    succeededWorkAttemptRuns.length > 0 && succeededWithoutSubmit > 0,
    's3_s4_succeeded_without_submit_missing',
  );
  const queuedOrRunningChildren = Number(
    (
      await db.query(
        `SELECT count(*)::int AS count
           FROM tasks t
           LEFT JOIN runs r ON r.task_id=t.id
          WHERE t.root_task_id=$1
            AND t.team_task_kind IN ('lead_turn','work_attempt','direct_message')
            AND (t.status IN ('queued','running') OR r.status IN ('queued','running'))`,
        [rootTaskId],
      )
    ).rows[0]?.count ?? 0,
  );
  assert(queuedOrRunningChildren === 0, 's3_s4_queued_running_children');
  const rosterCount = Number(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM team_member_runs WHERE team_run_id=$1',
        [teamRunId],
      )
    ).rows[0]?.count ?? 0,
  );
  const teamChildRunEvents = (
    await db.query(
      `SELECT run.id AS run_id,task.team_member_run_id,event.payload
         FROM runs run
         JOIN tasks task ON task.id=run.task_id
         JOIN run_events event ON event.run_id=run.id
        WHERE task.root_task_id=$1
          AND task.team_task_kind IN ('lead_turn','work_attempt','direct_message')
          AND event.type='output'
        ORDER BY run.id,event.sequence`,
      [rootTaskId],
    )
  ).rows;
  const transcriptFacts = transcriptEvidenceFacts(teamChildRunEvents);
  const completeTranscriptCoverage =
    transcriptFacts.membersWithTranscriptCount === rosterCount;
  const persistedTranscriptEvidence =
    transcriptFacts.outputEventCount > 0 &&
    transcriptFacts.authenticationFailureEvents === 0;
  marker('PAID_TRANSCRIPT_PARTIAL_OBSERVATION', {
    transcript_evidence: persistedTranscriptEvidence,
    members_with_transcript: transcriptFacts.membersWithTranscriptCount,
    expected_member_count: rosterCount,
    complete_coverage: completeTranscriptCoverage,
    output_event_count: transcriptFacts.outputEventCount,
    authentication_failure_events: transcriptFacts.authenticationFailureEvents,
  });
  marker('S3_S4_TIMEOUT_EVIDENCE_PROVEN', {
    s3_s4_runtime_projection_proven: true,
    known_product_blocker: 'succeeded_without_submit_absorbing',
    team_terminal: false,
    team_status: team.status,
    project_stop_reason_null: true,
    project_revision_positive: true,
    runtime_projection_exact: true,
    runtime_labels: expectedRuntimeLabels,
    work_item_count: projection.work_items.length,
    attempt_count: projectedAttemptCount,
    succeeded_work_attempt_run_count: succeededWorkAttemptRuns.length,
    succeeded_without_submit_count: succeededWithoutSubmit,
    queued_or_running_child_count: queuedOrRunningChildren,
    roster_member_count: rosterCount,
    persisted_output_event_count: transcriptFacts.outputEventCount,
    persisted_transcript_complete_coverage: completeTranscriptCoverage,
    persisted_transcript_evidence: persistedTranscriptEvidence,
    authentication_failure_events: transcriptFacts.authenticationFailureEvents,
  });
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
  #leadCreateSystemProtocolOccurrences = 0;
  #leadUserProtocolOccurrences = 0;
  #controlPlaneDeliveries = [];
  #failedAttemptInjected = false;
  #leadFailureCodeObserved = false;
  #cancelReplayEqual = false;
  #firstAttemptSubmissions = 0;
  #firstAttemptWaiters = [];
  get cancelReplayEqual() {
    return this.#cancelReplayEqual;
  }
  get leadFailureCodeObserved() {
    return this.#leadFailureCodeObserved;
  }
  observeControlPlanePrompt(input, role, memberName) {
    const firstLine = String(input.prompt ?? '').split('\n', 1)[0];
    const match = envelopePattern.exec(firstLine);
    assert(match, 'control_plane_envelope_missing_or_unanchored');
    const [, team, recipientEncoded, kind, senderEncoded, sequenceText] = match;
    const recipient = decodeEnvelopeAtom(recipientEncoded, 'recipient');
    const sender = decodeEnvelopeAtom(senderEncoded, 'sender');
    const sequence = Number(sequenceText);
    assert(
      team === teamRunId.slice(0, 8) &&
        Number.isSafeInteger(sequence) &&
        sequence > 0 &&
        input.prompt.includes(
          'The authoritative current state is available through agent-server tools.',
        ) &&
        !input.prompt.includes('<system>'),
      'control_plane_envelope_values_invalid',
    );
    if (role === 'lead') {
      assert(
        kind === 'lead_turn' &&
          recipient === fixtureNames.lead &&
          sender === 'agent-server' &&
          sequence === this.#leadTurns + 1,
        'lead_control_plane_envelope_values_invalid',
      );
    } else if (role === 'direct') {
      assert(
        kind === 'direct' &&
          recipient === fixtureNames.observer &&
          sender === fixtureNames.lead,
        'direct_control_plane_envelope_values_invalid',
      );
    } else {
      assert(
        (kind === 'wake' || kind === 'rework') &&
          recipient === memberName &&
          sender === fixtureNames.lead,
        'member_control_plane_envelope_values_invalid',
      );
    }
    this.#controlPlaneDeliveries.push({
      first_envelope_line: firstLine,
      kind,
      recipient,
      sender,
      sequence,
    });
    marker('CONTROL_PLANE_ENVELOPE_DELIVERED', {
      first_envelope_line: firstLine,
      kind,
      recipient,
      sender,
      sequence,
    });
  }
  emitPromptChannelEvidence(extraEnvelopeLines = []) {
    const firstEnvelopeLines = [
      ...this.#controlPlaneDeliveries.map(
        (delivery) => delivery.first_envelope_line,
      ),
      ...extraEnvelopeLines,
    ].filter((line, index, all) => all.indexOf(line) === index);
    marker('TEAM_PROMPT_CHANNEL_EVIDENCE', {
      lead_create_system_protocol_occurrences:
        this.#leadCreateSystemProtocolOccurrences,
      lead_user_protocol_occurrences: this.#leadUserProtocolOccurrences,
      control_plane_delivery_count: firstEnvelopeLines.length,
      first_envelope_lines: firstEnvelopeLines,
    });
  }
  async synchronizeFirstAttemptSubmissions() {
    this.#firstAttemptSubmissions += 1;
    if (this.#firstAttemptSubmissions === 2) {
      for (const release of this.#firstAttemptWaiters.splice(0)) release();
      return;
    }
    await new Promise((resolve) => this.#firstAttemptWaiters.push(resolve));
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
              arguments: {
                subject: 'old-turn-forbidden',
                assignee: fixtureNames.member,
              },
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
      provider: requestedProvider,
      model: requestedModel,
      checks: [],
    };
  }
  async execute(input, sink) {
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
      const provider = input.provider ?? requestedProvider;
      const model = input.model ?? requestedModel;
      assert(
        runtimeResolutionProviders.has(provider),
        'scripted_runtime_provider_invalid',
      );
      assert(
        supportedSmokeModels[provider]?.has(model),
        'scripted_runtime_model_invalid',
      );
      session = {
        client,
        transport,
        workspaceId:
          input.paseoWorkspaceId ?? `scripted-workspace-${randomUUID()}`,
        provider,
        model,
      };
      const callTool = session.client.callTool.bind(session.client);
      let canonicalActivitySequence = 0;
      session.client.callTool = async (request) => {
        const activityId = `scripted-team-${++canonicalActivitySequence}`;
        if (canonicalTeamMcpNames.has(request.name))
          await sink?.emit({
            kind: 'tool_status',
            activityId,
            category: 'other',
            status: 'running',
            label: 'Scripted Team MCP tool',
            summary: 'Scripted Team MCP lifecycle',
            toolName: request.name,
            resultObserved: false,
            provider,
          });
        const response = await callTool(request);
        if (canonicalTeamMcpNames.has(request.name)) {
          const failed = Boolean(
            response.isError || response.structuredContent?.error,
          );
          await sink?.emit({
            kind: 'tool_status',
            activityId,
            category: 'other',
            status: failed ? 'failed' : 'completed',
            label: 'Scripted Team MCP tool',
            summary: 'Scripted Team MCP lifecycle',
            toolName: request.name,
            resultObserved: true,
            provider,
          });
        }
        return response;
      };
      this.#sessions.set(providerAgentId, session);
      await input.onProviderBinding?.({
        providerAgentId,
        paseoWorkspaceId: session.workspaceId,
      });
      await sink?.emit({
        kind: 'tool_status',
        activityId: `scripted-tool-${providerAgentId}`,
        category: 'other',
        status: 'completed',
        label: 'Scripted MCP tool',
        summary: 'Completed',
        toolName: `${extension.name}_synthetic_stock_snapshot`,
      });
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
    const runtimeBinding = {
      kind: 'runtime_binding',
      role: directTurn
        ? 'direct'
        : tools.has('team_work_submit')
          ? 'member'
          : 'lead',
      operation: input.operation,
      provider_binding_hash: hash(providerAgentId),
    };
    runtimeCalls.push(runtimeBinding);
    if (directTurn) {
      this.observeControlPlanePrompt(input, 'direct', fixtureNames.observer);
      assert(
        input.prompt.includes('Direct Team message guidance:') &&
          !input.systemPrompt?.includes('Direct Team message guidance:') &&
          !input.systemPrompt?.includes('Assigned Team Work guidance:'),
        'direct_turn_kind_guidance_channel_invalid',
      );
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
      this.observeControlPlanePrompt(input, 'lead', fixtureNames.lead);
      const systemProtocolOccurrences = countOccurrences(
        input.systemPrompt ?? '',
        TEAM_LEAD_CONTROL_PROTOCOL,
      );
      const userProtocolOccurrences = countOccurrences(
        input.prompt,
        TEAM_LEAD_CONTROL_PROTOCOL,
      );
      if (input.operation === 'create')
        this.#leadCreateSystemProtocolOccurrences += systemProtocolOccurrences;
      this.#leadUserProtocolOccurrences += userProtocolOccurrences;
      assert(
        userProtocolOccurrences === 0,
        'lead_control_protocol_in_user_prompt',
      );
      assert(
        input.prompt.includes(
          'Permanent coordination rules are in the create-time system instructions.',
        ) &&
          input.prompt.includes('Current bounded Lead snapshot') &&
          input.prompt.includes('"goal":') &&
          input.prompt.includes('"work_items":') &&
          input.prompt.includes('"limits":') &&
          input.prompt.includes('"allowed_commands":') &&
          input.prompt.includes('"eligible_targets":'),
        'lead_dynamic_state_missing_from_user_prompt',
      );
      assert(
        !input.systemPrompt?.includes('Lead turn guidance:') &&
          !input.systemPrompt?.includes('Direct Team message guidance:') &&
          !input.systemPrompt?.includes('Assigned Team Work guidance:'),
        'turn_kind_guidance_in_system_prompt',
      );
      if (input.operation === 'create')
        assert(
          systemProtocolOccurrences === 1,
          'lead_create_system_protocol_occurrence_invalid',
        );
      else
        assert(
          systemProtocolOccurrences === 0,
          'lead_continue_system_protocol_occurrence_invalid',
        );
      marker('TEAM_LEAD_PROMPT_CHANNEL_CHECK', {
        operation: input.operation,
        create_system_protocol_occurrences:
          this.#leadCreateSystemProtocolOccurrences,
        user_protocol_occurrences: this.#leadUserProtocolOccurrences,
        dynamic_state_in_user: true,
      });
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
      if (this.#leadTurns === 1)
        assert(
          input.systemPrompt?.includes(canonicalSnapshotInvocation) &&
            input.systemPrompt.includes(
              reworkScenario ? 'Review rubric' : 'Golden-path review rubric',
            ),
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
              assignee: fixtureNames.member,
            },
          }),
        );
        value(
          await session.client.callTool({
            name: 'team_work_create',
            arguments: {
              subject: 'B',
              description: `Perform the declared ${fixtureNames.observer} preflight, then collect and submit the required canonical snapshot evidence.`,
              assignee: fixtureNames.observer,
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
      } else if (reworkScenario && this.#leadTurns === 2) {
        assert(
          input.prompt.includes('first submission incomplete') &&
            input.prompt.includes(`"assignee":"${fixtureNames.member}"`) &&
            input.prompt.includes(`"assignee":"${fixtureNames.observer}"`) &&
            (input.prompt.match(/"status":"completed"/gu)?.length ?? 0) >= 2,
          'lead_rework_review_snapshot_invalid',
        );
        value(
          await session.client.callTool({
            name: 'team_work_request_changes',
            arguments: {
              work_ref: 'work-1',
              assignee: fixtureNames.member,
              feedback:
                'Add the missing canonical fixture_ref, symbol ACME, and data_as_of 2026-07-31 evidence before resubmitting.',
            },
          }),
        );
        value(
          await session.client.callTool({
            name: 'team_work_accept',
            arguments: { work_ref: 'work-2' },
          }),
        );
        runtimeCalls.push({
          role: 'lead',
          turn: 2,
          tools: ['request_changes_A', 'accept_B'],
        });
      } else if (reworkScenario && this.#leadTurns === 3) {
        marker('REWORK_TURN3_ENTERED', {
          prompt_attempt_no_2: input.prompt.includes('"attempt_no":2'),
          prompt_canonical_evidence: input.prompt.includes(
            canonicalSnapshotInvocation,
          ),
        });
        let listedWork;
        try {
          listedWork = value(
            await session.client.callTool({
              name: 'team_work_list',
              arguments: {},
            }),
          );
        } catch (error) {
          marker('REWORK_TURN3_LIST_FAILED', sanitizedErrorDetail(error));
          throw error;
        }
        const workItems = Array.isArray(listedWork?.items)
          ? listedWork.items
          : [];
        const correctedWork = workItems.find(
          (item) => item.work_ref === 'work-1',
        );
        marker('REWORK_TURN3_LISTED', {
          work_list_items_shape: Array.isArray(listedWork?.items),
          work_found: Boolean(correctedWork),
          work_status: correctedWork?.status ?? null,
          latest_attempt_status: correctedWork?.latest_attempt?.status ?? null,
          latest_attempt_canonical_evidence: String(
            correctedWork?.latest_attempt?.summary ?? '',
          ).includes(canonicalSnapshotInvocation),
        });
        assert(
          correctedWork?.latest_attempt?.status === 'completed' &&
            String(correctedWork.latest_attempt.summary).includes(
              canonicalSnapshotInvocation,
            ),
          'lead_corrected_submission_missing',
        );
        try {
          value(
            await session.client.callTool({
              name: 'team_work_accept',
              arguments: { work_ref: 'work-1' },
            }),
          );
        } catch (error) {
          marker('REWORK_TURN3_ACCEPT_FAILED', sanitizedErrorDetail(error));
          throw error;
        }
        marker('REWORK_TURN3_ACCEPTED');
        runtimeCalls.push({
          role: 'lead',
          turn: 3,
          tool: 'accept_corrected_A',
        });
      } else if (this.#leadTurns === 2) {
        assert(
          input.prompt.includes(`"assignee":"${fixtureNames.member}"`),
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
          { subject: 'forbidden', assignee: fixtureNames.member },
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
          input.prompt.includes(`"assignee":"${fixtureNames.observer}"`),
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
              recipient: fixtureNames.observer,
              summary: `phase3-direct-sentinel ${fixtureNames.observer} coordination Bearer canary-secret /Users/canary`,
            },
          }),
        );
        const replay = value(
          await session.client.callTool({
            name: 'team_message_send',
            arguments: {
              recipient: fixtureNames.observer,
              summary: `phase3-direct-sentinel ${fixtureNames.observer} coordination Bearer canary-secret /Users/canary`,
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
            provider: session.provider,
            model: session.model,
            providerAgentId,
            paseoWorkspaceId: session.workspaceId,
            text: 'bounded turn completed',
            usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0 },
          };
        }
        if (!reworkScenario)
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
          tool: reworkScenario
            ? 'finish_after_rework'
            : 'finish_after_direct_delivery',
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
      const reworkDelivery = input.prompt.includes('Attempt number: 2');
      if (input.operation === 'create')
        assert(
          input.systemPrompt?.includes(canonicalSnapshotInvocation) &&
            input.systemPrompt.includes('Never guess fixture_ref'),
          'member_canonical_snapshot_args_missing',
        );
      else if (reworkDelivery)
        assert(
          input.prompt.includes('missing canonical fixture_ref') &&
            input.prompt.includes('data_as_of 2026-07-31'),
          'member_rework_feedback_missing',
        );
      this.#memberTurns += 1;
      const memberState = value(
        await session.client.callTool({ name: 'team_state', arguments: {} }),
      );
      runtimeBinding.member_name = memberState.member?.name;
      this.observeControlPlanePrompt(input, 'member', memberState.member?.name);
      assert(
        input.prompt.includes('Assigned Team Work guidance:') &&
          !input.systemPrompt?.includes('Assigned Team Work guidance:') &&
          !input.systemPrompt?.includes('Direct Team message guidance:'),
        'member_turn_kind_guidance_channel_invalid',
      );
      if (
        failedAttemptMode === 'baseline' ||
        (failedAttemptMode === 'fixed' &&
          !this.#failedAttemptInjected &&
          memberState.member?.name === fixtureNames.member)
      ) {
        this.#failedAttemptInjected = true;
        throw new Error('forced member runtime failure before submit');
      }
      const memberTurn =
        memberState.member?.name === fixtureNames.observer ? 2 : 1;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          memberState.member?.name === fixtureNames.observer ? 1_000 : 200,
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
      const summary =
        reworkScenario &&
        memberState.member?.name === fixtureNames.member &&
        !reworkDelivery
          ? 'first submission incomplete: snapshot collected but canonical fixture_ref, symbol, and data_as_of evidence omitted'
          : `valid canonical snapshot ${canonicalSnapshotInvocation}; data_as_of=2026-07-31; bounded result ${memberTurn}${reworkDelivery ? '; corrected after substantive Lead feedback' : ''}`;
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
      if (reworkScenario && !reworkDelivery)
        await this.synchronizeFirstAttemptSubmissions();
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
            recipient: fixtureNames.lead,
            summary: `${summary} forbidden member message`,
          },
          { allowMissingTool: true },
        ),
      };
      runtimeCalls.push({
        role: 'member',
        turn: reworkDelivery ? 3 : memberTurn,
        attempt: reworkDelivery ? 2 : 1,
        tools: ['synthetic_stock_snapshot', 'checkpoint', 'submit'],
        post_submit_rejections: postSubmitRejections,
      });
    }
    return {
      provider: session.provider,
      model: session.model,
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
  {
    method = 'GET',
    body,
    status = 200,
    authToken = token,
    technicalIdempotency = true,
  } = {},
) {
  const headers = {
    authorization: `Bearer ${authToken}`,
    'content-type': 'application/json',
    ...(technicalIdempotency ? { 'idempotency-key': randomUUID() } : {}),
  };
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
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
  const lead = name === fixtureNames.lead;
  const observer = name === fixtureNames.observer;
  const modelPolicyRef = lead
    ? 'free-only'
    : observer
      ? 'codex/deepseek-v4-flash'
      : 'claude/deepseek-v4-flash';
  const instructions = lead
    ? reworkScenario
      ? `Act directly as the Team Lead using only the canonical Team tools exposed in the current turn. A Lead control turn must never spawn or delegate to a subagent. Read the board first, perform every required canonical control action for the current state, then stop. Review rubric: both first attempts must complete before review. Work A is inadequate when its result omits the canonical ${canonicalSnapshotInvocation}, symbol ACME, or data_as_of 2026-07-31 evidence; request changes exactly once with substantive feedback while accepting qualifying Work B in the same control cycle. Accept corrected Work A only when all canonical evidence is present, then finish after both Work items are accepted. On the empty board create exactly Work A assigned to ${fixtureNames.member} and Work B assigned to ${fixtureNames.observer}, then stop. Never send a direct message, never invent refs, and never repeat a successful mutation.`
      : `Act directly as the Team Lead using only the canonical Team tools exposed in the current turn. A Lead control turn must never spawn or delegate to a subagent. Read the board first, perform every required canonical control action for the current state, then stop. Golden-path review rubric: a completed latest attempt whose submitted result contains the valid canonical ${canonicalSnapshotInvocation} result is qualifying and must be accepted. Do not request changes for nonblocking wording, caveats, formatting, or internal-path text; request changes remains available only for missing or invalid canonical snapshot evidence or another blocking requirement. On the empty board: create Work A assigned to ${fixtureNames.member} with description exactly "Immediately collect and submit the required canonical snapshot evidence without creating a child subagent."; then create independent Work B assigned to ${fixtureNames.observer} with description exactly "Perform the declared observer preflight, then collect and submit the required canonical snapshot evidence."; do not send a direct message on this turn; then stop. Never create any other Work. When work-1 has a qualifying completed latest attempt, even though the WorkItem status remains in_progress, call team_work_accept exactly as {"work_ref":"work-1"} and stop, even while other members are running. When work-2 has a qualifying completed latest attempt, even though the WorkItem status remains in_progress, call team_work_accept exactly as {"work_ref":"work-2"}; only if available_coordination_commands includes team_message_send, then call team_message_send twice consecutively to ${fixtureNames.observer} with identical parameters and summary exactly the concatenation of "phase3-direct-sentinel ${fixtureNames.observer} coordination Bearer ", "canary-", and "secret /Users/canary"; do not call team_finish on this turn; then stop. On every later turn when both Work items are accepted, never send another direct message; if team_finish is exposed, call team_finish exactly once and stop. The server exposes team_finish only when delivery and completion fences are safe. Plain text is never a substitute for a required canonical action. The second identical team_message_send is the sole required idempotent replay; never repeat any other successful mutation, never invent refs, and never call a tool that is absent.`
    : `Act directly as the assigned Team member using only the canonical Team and domain tools exposed in the current turn. ${observer ? 'You are the observer. Do not create a child subagent. Before using the canonical snapshot tool, complete exactly eight sequential preflight rounds. In each round call team_state exactly once as the only tool call in that response, wait for its result, then call team_work_list exactly once as the only tool call in the next response and wait for its result. Never batch preflight calls. After round eight, immediately continue to the canonical snapshot.' : 'You are the primary member. Do not create a child subagent; complete the canonical snapshot immediately.'} The member must call ${canonicalSnapshotInvocation} exactly once. Never guess fixture_ref paths or use an internal path. Include the successful canonical fixture_ref, symbol ACME, and data_as_of 2026-07-31 in the completed result, then call team_work_checkpoint once with a short safe summary and team_work_submit once with that completed result. After the first successful submit, stop all Team mutation. Never call team_message_send, never mutate another Work, never repeat a successful mutation, and never invent refs.`;
  const readableInstructions = instructions
    .replace('You are the observer.', `You are the ${fixtureNames.observer}.`)
    .replace(
      'You are the primary member.',
      `You are the ${fixtureNames.member}.`,
    )
    .replace('observer preflight', `${fixtureNames.observer} preflight`);
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
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: v2-${name}\nspec:\n  description: V2 retained smoke role\n  instructions: ${JSON.stringify(readableInstructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: ${modelPolicyRef}\n    mode: isolated\n  tools:\n${refs.map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`).join('\n')}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute exactly the next legal Team transition for your role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
function environmentYaml() {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: v2-smoke\nspec:\n  adapter: paseo\n  provider: ${requestedProvider}\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`;
}
function teamYaml(lead, member, observer, environment) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: v2-smoke-team\nspec:\n  environmentVersionId: ${environment}\n  lead:\n    name: ${fixtureNames.lead}\n    agentVersionId: ${lead}\n  roster:\n    - name: ${fixtureNames.member}\n      agentVersionId: ${member}\n    - name: ${fixtureNames.observer}\n      agentVersionId: ${observer}\n  coordination:\n    taskAssignment: lead_or_self_claim\n`;
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

function assertProductDtoShape(value, label) {
  const forbidden = new Set([
    'caller_idempotency_key',
    'idempotency_key',
    'principal_id',
    'principal_type',
    'root_task_id',
  ]);
  const walk = (current, path = label) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      assert(!forbidden.has(key), `${label}_${path}_${key}_leaked`);
      if (key === 'task_id')
        assert(
          path.endsWith('source_refs'),
          `${label}_task_id_outside_source_refs`,
        );
      walk(child, `${path}.${key}`);
    }
  };
  walk(value);
}

function assertProductProjectionDtoShape(value, label) {
  const forbidden = new Set([
    'caller_idempotency_key',
    'idempotency_key',
    'principal_id',
    'principal_type',
  ]);
  const technicalIds = new Set([
    'root_task_id',
    'team_run_id',
    'team_member_run_id',
    'task_id',
    'run_id',
    'team_message_id',
  ]);
  const walk = (current, path = label) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      assert(!forbidden.has(key), `${label}_${path}_${key}_leaked`);
      if (technicalIds.has(key))
        assert(
          path.endsWith('source_refs') ||
            path.endsWith('source_ref') ||
            path.endsWith('chat_detail.target'),
          `${label}_${path}_${key}_outside_source_refs`,
        );
      walk(child, `${path}.${key}`);
    }
  };
  walk(value);
}

async function runProductWorkDurableIdentityFlow({
  definitionId,
  definitionVersionId,
}) {
  const owner = { tenantId, workspaceId };
  const workResponse = await request('/api/v1/works', {
    method: 'POST',
    status: 201,
    technicalIdempotency: false,
    body: {
      definition_id: definitionId,
      definition_version_id: definitionVersionId,
      title: `Durable identity smoke ${suffix}`,
    },
  });
  const work = workResponse?.work;
  assert(
    work?.id && work.definition_version_id === definitionVersionId,
    'product_work_create_invalid',
  );
  assertProductDtoShape(workResponse, 'http_work_create');

  const triggerRef = `durable-identity-${suffix}`;
  const startPath = `/api/v1/works/${work.id}/runs`;
  const [firstStart, replayStart] = await Promise.all([
    request(startPath, {
      method: 'POST',
      status: 202,
      technicalIdempotency: false,
      body: { trigger_kind: 'manual', trigger_ref: triggerRef },
    }),
    request(startPath, {
      method: 'POST',
      status: 202,
      technicalIdempotency: false,
      body: { trigger_kind: 'manual', trigger_ref: triggerRef },
    }),
  ]);
  const firstRun = firstStart?.work_run;
  const replayRun = replayStart?.work_run;
  assert(
    firstRun?.id && replayRun?.id && firstRun.id === replayRun.id,
    'product_work_run_concurrent_replay_mismatch',
  );
  assertProductDtoShape(firstStart, 'http_work_run_start');
  assertProductDtoShape(replayStart, 'http_work_run_replay');
  const sameTriggerCount = await db.query(
    'SELECT count(*)::int AS count FROM work_runs WHERE work_id=$1 AND trigger_ref=$2',
    [work.id, triggerRef],
  );
  assert(
    sameTriggerCount.rows[0].count === 1,
    'product_work_run_replay_cardinality_invalid',
  );

  const secondTriggerRef = `durable-identity-second-${suffix}`;
  const secondStart = await request(startPath, {
    method: 'POST',
    status: 202,
    technicalIdempotency: false,
    body: { trigger_kind: 'manual', trigger_ref: secondTriggerRef },
  });
  assert(
    secondStart?.work_run?.id && secondStart.work_run.id !== firstRun.id,
    'product_work_run_distinct_trigger_not_distinct',
  );
  assertProductDtoShape(secondStart, 'http_work_run_second_trigger');
  const workRunIds = [firstRun.id, secondStart.work_run.id];
  const runRows = await db.query(
    'SELECT id,root_task_id,bound_at FROM work_runs WHERE id=ANY($1::uuid[]) ORDER BY id',
    [workRunIds],
  );
  assert(
    runRows.rowCount === 2 &&
      runRows.rows.every((row) => row.root_task_id && row.bound_at),
    'product_work_run_root_binding_missing',
  );

  const firstRootTaskId = firstRunSourceTaskId(firstStart);
  rootTaskId = firstRootTaskId;
  const rootRunRow = (
    await db.query(
      'SELECT r.id,r.status,r.runtime FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.id=$1',
      [firstRootTaskId],
    )
  ).rows[0];
  assert(rootRunRow?.id, 'product_work_root_run_missing');
  const rootExecution = await service.singleRunDebug.claimAndExecute(
    rootRunRow.id,
  );
  assert(rootExecution.claimed, 'product_work_root_run_not_claimed');
  const firstTeamRunRow = await waitFor(
    async () =>
      (
        await db.query('SELECT id FROM team_runs WHERE root_task_id=$1', [
          firstRootTaskId,
        ])
      ).rows[0],
    (row) => Boolean(row?.id),
    'product_work_team_run_not_materialized',
  );
  teamRunId = firstTeamRunRow.id;

  const captureProjection = async (workRunId, label) => {
    const path = `/api/v1/works/${work.id}/runs/${workRunId}`;
    const raw = await request(path, { status: 200 });
    const traceRaw = await request(`${path}/trace`, { status: 200 });
    assertProductProjectionDtoShape(raw, `${label}_work_run`);
    assertProductProjectionDtoShape(traceRaw, `${label}_trace`);
    const parsed = ProductWorkRunResponseSchema.parse(raw);
    const traceParsed = ProductRunTraceResponseSchema.parse(traceRaw);
    assert(
      parsed.projection_status === 'internally_anchored' &&
        parsed.work?.id === work.id &&
        parsed.work_run?.id === workRunId,
      `${label}_work_run_parse_invalid`,
    );
    assert(
      traceParsed.projection_status === 'internally_anchored' &&
        traceParsed.work?.id === work.id &&
        traceParsed.work_run?.id === workRunId,
      `${label}_trace_parse_invalid`,
    );
    return { raw, traceRaw, parsed, traceParsed };
  };
  const isEmptyCollectionBranch = (captured) =>
    captured.parsed.work_items.length === 0 &&
    captured.parsed.messages.length === 0 &&
    captured.traceParsed.work_items.length === 0 &&
    captured.traceParsed.messages.length === 0;
  let emptyCollectionProjection = await captureProjection(
    firstRun.id,
    'product_projection_pre_provider',
  );
  let emptyCollectionWorkRunId = firstRun.id;
  if (!isEmptyCollectionBranch(emptyCollectionProjection)) {
    const secondRootTaskId =
      secondStart.execution_receipt?.source_refs?.task_id;
    assert(
      secondRootTaskId && secondRootTaskId !== firstRootTaskId,
      'product_work_second_root_task_missing_for_empty_projection',
    );
    const secondRootRunRow = (
      await db.query(
        'SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.id=$1',
        [secondRootTaskId],
      )
    ).rows[0];
    assert(secondRootRunRow?.id, 'product_work_second_root_run_missing');
    const secondRootExecution = await service.singleRunDebug.claimAndExecute(
      secondRootRunRow.id,
    );
    assert(
      secondRootExecution.claimed,
      'product_work_second_root_run_not_claimed',
    );
    await waitFor(
      async () =>
        (
          await db.query('SELECT id FROM team_runs WHERE root_task_id=$1', [
            secondRootTaskId,
          ])
        ).rows[0],
      (row) => Boolean(row?.id),
      'product_work_second_team_run_not_materialized',
    );
    emptyCollectionProjection = await captureProjection(
      secondStart.work_run.id,
      'product_projection_pre_provider_second_run',
    );
    emptyCollectionWorkRunId = secondStart.work_run.id;
  }
  assert(
    isEmptyCollectionBranch(emptyCollectionProjection),
    'product_work_empty_collection_branch_missing',
  );
  marker('PRODUCT_WORK_PROJECTION_EMPTY_BRANCH_PROVEN', {
    empty_arrays_proven: true,
    work_run_status: 200,
    trace_status: 200,
    work_run_sha256: hash(JSON.stringify(emptyCollectionProjection.raw)),
    trace_sha256: hash(JSON.stringify(emptyCollectionProjection.traceRaw)),
    work_run_id_sha256: hash(emptyCollectionWorkRunId),
    top_level_schema_parse: true,
  });
  const productLeadRunId = await queued('lead_turn');
  const providerExecution =
    await service.singleRunDebug.claimAndExecute(productLeadRunId);
  assert(providerExecution.claimed, 'product_work_provider_run_not_claimed');
  const providerRun = (
    await db.query(
      `SELECT r.id,r.status,r.runtime,t.root_task_id
         FROM runs r JOIN tasks t ON t.id=r.task_id
        WHERE r.id=$1`,
      [productLeadRunId],
    )
  ).rows[0];
  assert(
    providerRun?.status === 'succeeded',
    'product_work_provider_run_not_succeeded',
  );
  assert(
    providerRun.root_task_id === firstRootTaskId,
    'product_work_provider_root_task_mismatch',
  );
  const providerRuntime = providerRun.runtime ?? {};
  const provider =
    typeof providerRuntime.provider === 'string'
      ? providerRuntime.provider
      : null;
  const model =
    typeof providerRuntime.model === 'string' ? providerRuntime.model : null;
  assert(provider && model, 'product_work_root_provider_evidence_missing');
  const productWorkRunPath = `/api/v1/works/${work.id}/runs/${firstRun.id}`;
  const productTracePath = `${productWorkRunPath}/trace`;
  const productWorkRunRaw = await request(productWorkRunPath, {
    status: 200,
  });
  const productTraceRaw = await request(productTracePath, { status: 200 });
  const productWorkRun = ProductWorkRunResponseSchema.parse(productWorkRunRaw);
  const productTrace = ProductRunTraceResponseSchema.parse(productTraceRaw);
  assert(
    productWorkRun.projection_status === 'internally_anchored' &&
      productWorkRun.work?.id === work.id &&
      productWorkRun.work_run?.id === firstRun.id,
    'product_work_projection_success_branch_invalid',
  );
  assert(
    productTrace.projection_status === 'internally_anchored' &&
      productTrace.work?.id === work.id &&
      productTrace.work_run?.id === firstRun.id,
    'product_trace_projection_success_branch_invalid',
  );
  assert(
    Array.isArray(productWorkRun.messages) &&
      Array.isArray(productTrace.messages),
    'product_projection_messages_branch_invalid',
  );
  const expectedTimelineCoverage = {
    scope: 'mcp_dispatch_and_confirmation',
    completeness: 'mcp_only',
    excluded_execution: [
      'direct_shell',
      'direct_file_edit',
      'other_non_mcp_execution',
    ],
  };
  assert(
    JSON.stringify(productTrace.timeline_coverage) ===
      JSON.stringify(expectedTimelineCoverage),
    'product_trace_d18_1_timeline_coverage_invalid',
  );
  const traceActorIds = new Set(productTrace.actors.map((actor) => actor.id));
  const traceWorkItemsById = new Map(
    productTrace.work_items.map((item) => [item.id, item]),
  );
  const traceWorkItemIds = new Set(
    productTrace.work_items.map((item) => item.id),
  );
  const traceRunsById = new Map(
    productTrace.runs.map((run) => [run.source_refs.run_id, run]),
  );
  for (const run of productTrace.runs) {
    assert(
      run.source_refs.root_task_id === firstRootTaskId &&
        run.source_refs.task_id &&
        run.source_refs.run_id,
      'product_trace_run_source_refs_invalid',
    );
    if (run.actor_id !== null)
      assert(
        traceActorIds.has(run.actor_id),
        'product_trace_run_actor_link_invalid',
      );
    if (run.work_item_id !== null)
      assert(
        traceWorkItemIds.has(run.work_item_id) &&
          traceWorkItemsById.get(run.work_item_id)?.actor_id === run.actor_id,
        'product_trace_run_work_item_link_invalid',
      );
    if (run.started_at !== null)
      assert(
        !Number.isNaN(Date.parse(run.started_at)),
        'product_trace_run_started_at_invalid',
      );
    if (run.ended_at !== null) {
      assert(
        run.started_at !== null &&
          !Number.isNaN(Date.parse(run.ended_at)) &&
          new Date(run.ended_at) >= new Date(run.started_at),
        'product_trace_run_ended_at_invalid',
      );
    }
    if (['succeeded', 'failed', 'cancelled'].includes(run.status))
      assert(
        run.started_at !== null && run.ended_at !== null,
        'product_trace_terminal_run_timing_missing',
      );
  }
  const mcpActivities = productTrace.mcp_activities;
  if (productWorkDurableIdentity) {
    assert(mcpActivities.length > 0, 'product_trace_mcp_activities_missing');
    assert(
      mcpActivities.some(
        (activity) =>
          activity.status === 'completed' &&
          activity.result_capture_status === 'redacted',
      ),
      'product_trace_mcp_completed_redacted_missing',
    );
  }
  const mcpOperationCaptureStatusCounts = { present: 0, not_present: 0 };
  const mcpResultCaptureStatusCounts = { redacted: 0, not_present: 0 };
  for (const activity of mcpActivities) {
    const run = traceRunsById.get(activity.source_refs.run_id);
    assert(run, 'product_trace_mcp_activity_run_pointer_invalid');
    assert(
      activity.source_refs.root_task_id === firstRootTaskId &&
        activity.source_refs.task_id === run.source_refs.task_id &&
        activity.chat_detail.method === 'GET' &&
        activity.chat_detail.path ===
          `/api/v1/runs/${activity.source_refs.run_id}/events?after=${activity.sequence - 1}` &&
        activity.chat_detail.target.run_id === activity.source_refs.run_id &&
        activity.chat_detail.target.sequence === activity.sequence &&
        activity.chat_detail.target.activity_id === activity.activity_id,
      'product_trace_mcp_activity_pointer_invalid',
    );
    if (run.actor_id !== null)
      assert(
        activity.source_refs.actor_id === run.actor_id,
        'product_trace_mcp_activity_actor_link_invalid',
      );
    else
      assert(
        activity.source_refs.actor_id === undefined,
        'product_trace_mcp_activity_unexpected_actor_link',
      );
    if (run.work_item_id !== null)
      assert(
        activity.source_refs.work_item_id === run.work_item_id,
        'product_trace_mcp_activity_work_item_link_invalid',
      );
    else
      assert(
        activity.source_refs.work_item_id === undefined,
        'product_trace_mcp_activity_unexpected_work_item_link',
      );
    mcpOperationCaptureStatusCounts[activity.operation_capture_status] += 1;
    mcpResultCaptureStatusCounts[activity.result_capture_status] += 1;
    assert(
      activity.provenance === 'server_authorized_team_mcp_catalog' &&
        activity.tool_identity_capture_status === 'present' &&
        activity.operation_capture_status === 'not_present' &&
        activity.result_capture_status ===
          (activity.status === 'completed' ? 'redacted' : 'not_present') &&
        !Object.prototype.hasOwnProperty.call(activity, 'detail') &&
        !Object.prototype.hasOwnProperty.call(activity, 'result'),
      'product_trace_mcp_activity_capture_status_not_honest',
    );
  }
  markerRaw('PRODUCT_RUN_TRACE_ACCEPTANCE_ARTIFACT', {
    work_id: work.id,
    work_run_id: firstRun.id,
    root_task_id: firstRootTaskId,
    product_trace_path: productTracePath,
    trace_json: productTraceRaw,
    projection_status: productTrace.projection_status,
    timeline_coverage: productTrace.timeline_coverage,
    mcp_activities_count: mcpActivities.length,
    mcp_activities_status: mcpActivities.length > 0 ? 'present' : 'not_present',
    mcp_operation_capture_status_counts: mcpOperationCaptureStatusCounts,
    mcp_result_capture_status_counts: mcpResultCaptureStatusCounts,
  });
  const nullExecutionAttempt = productWorkRun.work_items
    .flatMap((item) => item.attempts)
    .find((attempt) => !('task_id' in attempt.source_refs));
  assert(
    nullExecutionAttempt &&
      nullExecutionAttempt.feedback_summary === null &&
      nullExecutionAttempt.result_summary === null,
    'product_projection_null_execution_attempt_missing',
  );
  const notFoundWorkRunRaw = await request(
    `/api/v1/works/${randomUUID()}/runs/${randomUUID()}`,
    { status: 404 },
  );
  const notFoundTraceRaw = await request(
    `/api/v1/works/${randomUUID()}/runs/${randomUUID()}/trace`,
    { status: 404 },
  );
  const notFoundWorkRun =
    ProductWorkRunResponseSchema.parse(notFoundWorkRunRaw);
  const notFoundTrace = ProductRunTraceResponseSchema.parse(notFoundTraceRaw);
  assert(
    'error' in notFoundWorkRun &&
      notFoundWorkRun.error.code === 'work_run_not_found' &&
      'error' in notFoundTrace &&
      notFoundTrace.error.code === 'work_run_not_found',
    'product_projection_not_found_branch_invalid',
  );
  const invalidWorkRunRaw = await request(
    `/api/v1/works/not-a-uuid/runs/${firstRun.id}`,
    { status: 400 },
  );
  const invalidTraceRaw = await request(
    `/api/v1/works/${work.id}/runs/not-a-uuid/trace`,
    { status: 400 },
  );
  const invalidWorkRun = ProductWorkRunResponseSchema.parse(invalidWorkRunRaw);
  const invalidTrace = ProductRunTraceResponseSchema.parse(invalidTraceRaw);
  assert(
    'error' in invalidWorkRun &&
      invalidWorkRun.error.code === 'invalid_request' &&
      'error' in invalidTrace &&
      invalidTrace.error.code === 'invalid_request',
    'product_projection_invalid_uuid_branch_invalid',
  );
  const healthLive = await request('/health/live', {
    technicalIdempotency: false,
    status: 200,
  });
  const serviceRevision =
    typeof healthLive?.version === 'string' ? healthLive.version : null;
  const correlation = (
    await db.query(
      `SELECT w.id AS work_id,wr.id AS work_run_id,wr.root_task_id,
              t.id AS root_task_row_id,tr.id AS team_run_id
         FROM works w
         JOIN work_runs wr
           ON wr.work_id=w.id AND wr.tenant_id=$3 AND wr.workspace_id=$4::uuid
         JOIN tasks t
           ON t.id=wr.root_task_id AND t.tenant_id=$3 AND t.workspace_id=$4::text
         JOIN team_runs tr
           ON tr.root_task_id=t.id
          AND tr.tenant_id=$3 AND tr.workspace_id=$4::text
        WHERE w.id=$1 AND wr.id=$2
          AND w.tenant_id=$3 AND w.workspace_id=$4::uuid
        LIMIT 1`,
      [work.id, firstRun.id, tenantId, workspaceId],
    )
  ).rows[0];
  assert(
    correlation?.work_id === work.id &&
      correlation.work_run_id === firstRun.id &&
      correlation.root_task_id === firstRootTaskId &&
      correlation.root_task_row_id === firstRootTaskId &&
      correlation.team_run_id === teamRunId,
    'product_work_db_correlation_invalid',
  );
  const sourceCounts = (
    await db.query(
      `SELECT
          (SELECT count(*)::int FROM team_work_items
             WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3) AS work_items,
          (SELECT count(*)::int FROM team_work_item_attempts
             WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3) AS attempts,
          (SELECT count(*)::int FROM team_work_item_attempts
             WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3
               AND execution_task_id IS NULL) AS null_execution_attempts,
          (SELECT count(*)::int FROM team_work_item_attempts
             WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3
               AND feedback IS NULL AND result_summary IS NULL) AS nullable_attempt_fields,
          (SELECT count(*)::int FROM team_messages
             WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3) AS messages,
          (SELECT count(*)::int FROM team_member_runs
             WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3) AS actors,
          (SELECT count(*)::int FROM runs r
             JOIN tasks t ON t.id=r.task_id
             JOIN team_runs tr
               ON tr.root_task_id=t.root_task_id
              AND tr.id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3
             WHERE t.root_task_id=$4
               AND t.tenant_id=$2 AND t.workspace_id=$3) AS runs,
          (SELECT count(*)::int FROM run_events e
             JOIN runs r ON r.id=e.run_id
             JOIN tasks t ON t.id=r.task_id
             JOIN team_runs tr
               ON tr.root_task_id=t.root_task_id
              AND tr.id=$1 AND tr.tenant_id=$2 AND tr.workspace_id=$3
             WHERE t.root_task_id=$4
               AND t.tenant_id=$2 AND t.workspace_id=$3) AS events,
          (SELECT count(*)::int FROM team_member_runs
             WHERE team_run_id=$1 AND tenant_id=$2 AND workspace_id=$3
               AND name IS NULL) AS nullable_actor_labels`,
      [teamRunId, tenantId, workspaceId, firstRootTaskId],
    )
  ).rows[0];
  const responseAttemptCount = productWorkRun.work_items.reduce(
    (count, item) => count + item.attempts.length,
    0,
  );
  const responseNullableActorLabels = productWorkRun.actors.filter(
    (actor) => actor.name === null,
  ).length;
  const responseNullableAttemptFields = productWorkRun.work_items
    .flatMap((item) => item.attempts)
    .filter(
      (attempt) =>
        attempt.feedback_summary === null && attempt.result_summary === null,
    ).length;
  assert(
    Number(sourceCounts.work_items) === productWorkRun.work_items.length &&
      Number(sourceCounts.work_items) === productTrace.work_items.length &&
      Number(sourceCounts.attempts) === responseAttemptCount &&
      Number(sourceCounts.messages) === productWorkRun.messages.length &&
      Number(sourceCounts.messages) === productTrace.messages.length &&
      Number(sourceCounts.actors) === productWorkRun.actors.length &&
      Number(sourceCounts.actors) === productTrace.actors.length &&
      Number(sourceCounts.nullable_actor_labels) ===
        responseNullableActorLabels &&
      Number(sourceCounts.nullable_attempt_fields) ===
        responseNullableAttemptFields &&
      Number(sourceCounts.nullable_attempt_fields) > 0 &&
      Number(sourceCounts.null_execution_attempts) > 0 &&
      Number(sourceCounts.runs) === productTrace.runs.length &&
      Number(sourceCounts.events) === productTrace.events.length,
    'product_work_projection_source_counts_mismatch',
  );
  marker('PRODUCT_WORK_PROJECTION_HTTP_CONTRACT_PROVEN', {
    ...(serviceRevision
      ? {
          service_revision: serviceRevision,
          service_revision_capture_status: 'complete',
        }
      : { service_revision_capture_status: 'not_present' }),
    work_run_status: 200,
    work_run_sha256: hash(JSON.stringify(productWorkRunRaw)),
    trace_status: 200,
    trace_sha256: hash(JSON.stringify(productTraceRaw)),
    branches: {
      work_run_success: true,
      trace_success: true,
      not_found_404: true,
      invalid_uuid_400: true,
    },
    empty_arrays_proven: isEmptyCollectionBranch(emptyCollectionProjection),
    empty_collection_work_run_sha256: hash(
      JSON.stringify(emptyCollectionProjection.raw),
    ),
    empty_collection_trace_sha256: hash(
      JSON.stringify(emptyCollectionProjection.traceRaw),
    ),
    empty_collection_work_run_id_sha256: hash(emptyCollectionWorkRunId),
    nullable_fields_proven:
      Number(sourceCounts.nullable_attempt_fields) > 0 &&
      responseNullableAttemptFields > 0,
    not_found_statuses: { work_run: 404, trace: 404 },
    invalid_uuid_statuses: { work_run: 400, trace: 400 },
    null_execution_attempt_proven: true,
    correlation_sha256: {
      work_id: hash(correlation.work_id),
      work_run_id: hash(correlation.work_run_id),
      root_task_id: hash(correlation.root_task_id),
      team_run_id: hash(correlation.team_run_id),
    },
    source_row_counts: {
      work_items: Number(sourceCounts.work_items),
      attempts: Number(sourceCounts.attempts),
      null_execution_attempts: Number(sourceCounts.null_execution_attempts),
      nullable_attempt_fields: Number(sourceCounts.nullable_attempt_fields),
      messages: Number(sourceCounts.messages),
      actors: Number(sourceCounts.actors),
      runs: Number(sourceCounts.runs),
      events: Number(sourceCounts.events),
    },
    nullable_actor_label_evidence: {
      source_count: Number(sourceCounts.nullable_actor_labels),
      response_count: responseNullableActorLabels,
      matched: true,
    },
    nullable_attempt_fields_evidence: {
      source_count: Number(sourceCounts.nullable_attempt_fields),
      response_count: responseNullableAttemptFields,
      matched: true,
    },
  });
  marker('PRODUCT_WORK_ROOT_PROVIDER_EVIDENCE', {
    provider,
    model,
    root_run_id: rootRunRow.id,
    root_run_sha256: hash(rootRunRow.id),
    provider_run_id: providerRun.id,
    provider_run_sha256: hash(providerRun.id),
    status: providerRun.status,
  });
  if (process.env.PRODUCT_LINEAGE_GOLDEN_OUTPUT && !scriptedRuntime) {
    const recording = await recordProductLineageGolden({
      db,
      rootTaskId: firstRootTaskId,
      teamRunId,
      providerRun: 'real',
      serviceRevision:
        process.env.PRODUCT_LINEAGE_SOURCE_REVISION ??
        process.env.GIT_SHA ??
        serviceRevision ??
        '',
      productWorkRunRaw,
      productTraceRaw,
      correlation: {
        ...correlation,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        principal_type: 'service_account',
        principal_id: principalId,
      },
      sourceCounts,
      providerEvidence: {
        provider,
        model,
        root_run_sha256: hash(rootRunRow.id),
        provider_run_sha256: hash(providerRun.id),
      },
    });
    marker('PRODUCT_LINEAGE_GOLDEN_RECORDED', recording);
  }
  const { PostgresWorkIdentityRepository } =
    await import('../../src/infrastructure/postgres/postgres-work-identity-repository.ts');
  const repository = new PostgresWorkIdentityRepository(db);
  const now = new Date().toISOString();
  const replayedBinding = await repository.bindRootTaskCas({
    workRunId: firstRun.id,
    rootTaskId: firstRootTaskId,
    owner,
    now,
  });
  assert(
    replayedBinding.rootTaskId === firstRootTaskId,
    'product_work_same_task_cas_replay_failed',
  );
  const secondRootTaskId = secondStart.execution_receipt?.source_refs?.task_id;
  assert(
    secondRootTaskId && secondRootTaskId !== firstRootTaskId,
    'product_work_second_root_task_missing',
  );
  let bindingConflict = false;
  try {
    await repository.bindRootTaskCas({
      workRunId: firstRun.id,
      rootTaskId: secondRootTaskId,
      owner,
      now,
    });
  } catch (error) {
    const { WorkRunBindingConflictError } =
      await import('../../src/domain/work/work-run.ts');
    bindingConflict = error instanceof WorkRunBindingConflictError;
  }
  assert(
    bindingConflict,
    'product_work_different_task_binding_conflict_missing',
  );
  const unchanged = await repository.findWorkRunById(firstRun.id, owner);
  assert(
    unchanged?.rootTaskId === firstRootTaskId,
    'product_work_binding_conflict_mutated_original',
  );
  marker('PRODUCT_WORK_ROOT_TASK_CAS_EVIDENCE', {
    same_task_replay: true,
    different_task_binding_conflict: true,
    original_root_task_id_unchanged: true,
  });

  const manifestBefore = await repository.getResolvedManifest(
    firstRun.id,
    owner,
  );
  assert(
    manifestBefore?.entries.length === 1 &&
      manifestBefore.entries[0].slot === 'definition' &&
      manifestBefore.entries[0].resolvedVersionId === definitionVersionId,
    'product_work_definition_manifest_missing',
  );
  const manifestReplay = await request(startPath, {
    method: 'POST',
    status: 202,
    technicalIdempotency: false,
    body: { trigger_kind: 'manual', trigger_ref: triggerRef },
  });
  assert(
    manifestReplay.execution_receipt?.reused === true,
    'product_work_manifest_replay_not_reused',
  );
  const manifestAfter = await repository.getResolvedManifest(
    firstRun.id,
    owner,
  );
  assert(
    JSON.stringify(manifestBefore) === JSON.stringify(manifestAfter),
    'product_work_definition_manifest_unstable',
  );
  marker('PRODUCT_WORK_DEFINITION_MANIFEST_STABLE', {
    work_run_id: firstRun.id,
    entries: manifestAfter.entries.map((entry) => ({
      slot: entry.slot,
      resource_kind: entry.resourceKind,
      requested_ref: entry.requestedRef,
      resolved_version_id: entry.resolvedVersionId,
    })),
  });

  const { toExecutionReceiptResponse, toWorkResponse, toWorkRunResponse } =
    await import('../../src/contracts/product-work-commands.ts');
  assertProductDtoShape(
    {
      work: toWorkResponse({
        id: work.id,
        tenantId: work.tenant_id,
        workspaceId: work.workspace_id,
        definitionId: work.definition_id,
        currentDefinitionVersionId: work.definition_version_id,
        title: work.title,
        origin: work.origin,
        archivedAt: work.archived_at,
        createdAt: work.created_at,
        updatedAt: work.updated_at,
      }),
    },
    'mcp_work_create',
  );
  assertProductDtoShape(
    {
      work_run: toWorkRunResponse({
        ...firstRun,
        workId: firstRun.work_id,
        definitionVersionId: firstRun.definition_version_id,
        triggerKind: firstRun.trigger_kind,
        triggerRef: firstRun.trigger_ref,
        expiresAt: firstRun.expires_at,
        boundAt: firstRun.bound_at,
        createdAt: firstRun.created_at,
        updatedAt: firstRun.updated_at,
      }),
      execution_receipt: toExecutionReceiptResponse({
        reused: true,
        taskId: firstRootTaskId,
      }),
    },
    'mcp_work_run_start',
  );
  marker('PRODUCT_WORK_HTTP_MCP_DTO_CONTRACT_PROVEN', {
    technical_idempotency_absent: true,
    principal_fields_absent: true,
    raw_technical_ids_absent: true,
    task_id_only_in_source_refs: true,
  });
  const siblingWorks = [];
  for (const ordinal of [2, 3]) {
    const created = await request('/api/v1/works', {
      method: 'POST',
      status: 201,
      technicalIdempotency: false,
      body: {
        definition_id: definitionId,
        definition_version_id: definitionVersionId,
        title: `Durable identity enumeration ${ordinal} ${suffix}`,
      },
    });
    siblingWorks.push(created.work);
  }
  const expectedWorkIds = (
    await db.query(
      `SELECT id FROM works WHERE tenant_id=$1 AND workspace_id=$2 AND archived_at IS NULL ORDER BY created_at ASC,id ASC`,
      [tenantId, workspaceId],
    )
  ).rows.map((row) => row.id);
  const workPageOne = await request('/api/v1/works?limit=2', {
    technicalIdempotency: false,
  });
  assert(workPageOne.next_cursor, 'product_work_first_page_cursor_missing');
  const workPageTwo = await request(
    `/api/v1/works?limit=2&cursor=${encodeURIComponent(workPageOne.next_cursor)}`,
    { technicalIdempotency: false },
  );
  const enumeratedWorkIds = [
    ...workPageOne.works.map((item) => item.id),
    ...workPageTwo.works.map((item) => item.id),
  ];
  assert(JSON.stringify(enumeratedWorkIds) === JSON.stringify(expectedWorkIds), 'product_work_two_page_id_set_mismatch');
  assert(new Set(enumeratedWorkIds).size === enumeratedWorkIds.length, 'product_work_two_page_duplicate_id');
  assert(workPageTwo.next_cursor === null, 'product_work_unexpected_third_page');
  const expectedRunIds = (
    await db.query(
      `SELECT id FROM work_runs WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3 AND (root_task_id IS NOT NULL OR expires_at > now()) ORDER BY created_at ASC,id ASC`,
      [tenantId, workspaceId, work.id],
    )
  ).rows.map((row) => row.id);
  const runPageOne = await request(`/api/v1/works/${work.id}/runs?limit=1`, { technicalIdempotency: false });
  assert(runPageOne.next_cursor, 'product_work_run_first_page_cursor_missing');
  const runPageTwo = await request(`/api/v1/works/${work.id}/runs?limit=1&cursor=${encodeURIComponent(runPageOne.next_cursor)}`, { technicalIdempotency: false });
  const enumeratedRunIds = [
    ...runPageOne.work_runs.map((item) => item.id),
    ...runPageTwo.work_runs.map((item) => item.id),
  ];
  assert(JSON.stringify(enumeratedRunIds) === JSON.stringify(expectedRunIds), 'product_work_run_two_page_id_set_mismatch');
  assert(new Set(enumeratedRunIds).size === enumeratedRunIds.length, 'product_work_run_two_page_duplicate_id');
  assert(
    runPageTwo.next_cursor === null,
    'product_work_run_unexpected_third_page',
  );
  const foreignWorks = await request('/api/v1/works?limit=100', {
    authToken: foreignToken,
    technicalIdempotency: false,
  });
  const foreignRuns = await request(`/api/v1/works/${work.id}/runs?limit=100`, {
    authToken: foreignToken,
    technicalIdempotency: false,
  });
  assert(
    foreignWorks.works.length === 0 && foreignRuns.work_runs.length === 0,
    'product_work_owner_scope_leak',
  );
  const foreignCursor = await request(
    `/api/v1/works?limit=2&cursor=${encodeURIComponent(workPageOne.next_cursor)}`,
    { authToken: foreignToken, status: 400, technicalIdempotency: false },
  );
  assert(
    foreignCursor.error?.code === 'invalid_cursor',
    'product_work_cursor_owner_not_bound',
  );
  const wrongKindCursor = await request(
    `/api/v1/works/${work.id}/runs?limit=1&cursor=${encodeURIComponent(workPageOne.next_cursor)}`,
    { status: 400, technicalIdempotency: false },
  );
  assert(
    wrongKindCursor.error?.code === 'invalid_cursor',
    'product_work_cursor_kind_not_bound',
  );
  marker('PRODUCT_WORK_ENUMERATION_PASS', {
    owner_work_count: expectedWorkIds.length,
    work_page_ids: [
      workPageOne.works.map((item) => item.id),
      workPageTwo.works.map((item) => item.id),
    ],
    work_ids_exact_match: true,
    work_ids_unique: true,
    owner_run_count: expectedRunIds.length,
    run_page_ids: [
      runPageOne.work_runs.map((item) => item.id),
      runPageTwo.work_runs.map((item) => item.id),
    ],
    run_ids_exact_match: true,
    run_ids_unique: true,
    foreign_work_count: foreignWorks.works.length,
    foreign_run_count: foreignRuns.work_runs.length,
    cursor_owner_bound: true,
    cursor_kind_bound: true,
  });
  marker('PRODUCT_WORK_EXPIRED_LIST_CAPABILITY_DEFERRED', {
    capability_deferred: true,
    reason: 'no_public_expired_work_run_list_entry_in_this_slice',
  });
  marker('PRODUCT_WORK_DURABLE_IDENTITY_PASS', {
    work_id: work.id,
    work_sha256: hash(work.id),
    work_run_ids: workRunIds,
    work_run_sha256s: workRunIds.map((id) => hash(id)),
    root_task_sha256s: [firstRootTaskId, secondRootTaskId].map((id) =>
      hash(id),
    ),
    root_task_receipts: [
      {
        work_run_id: firstRun.id,
        task_id: firstRootTaskId,
        run_id: rootRunRow.id,
      },
      { work_run_id: secondStart.work_run.id, task_id: secondRootTaskId },
    ],
  });
  throw new RecoveryComplete();
}

function firstRunSourceTaskId(response) {
  const taskId = response?.execution_receipt?.source_refs?.task_id;
  assert(
    typeof taskId === 'string' && taskId.length > 0,
    'product_work_root_task_receipt_missing',
  );
  return taskId;
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
  assert(
    runtimeResolutionProviders.has(requestedProvider),
    'unsupported_paseo_provider',
  );
  assert(requestedModel, 'missing_paid_smoke_model');
  assert(
    supportedSmokeModels[requestedProvider].has(requestedModel),
    'unsupported_paid_smoke_model',
  );
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
  if (!scriptedRuntime && requestedProvider === 'opencode') {
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
  if (!scriptedRuntime) {
    assert(process.env.OPENCODE_GO_API_KEY, 'missing_OPENCODE_GO_API_KEY');
    Object.assign(process.env, {
      ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go',
      ANTHROPIC_API_KEY: process.env.OPENCODE_GO_API_KEY,
      ANTHROPIC_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_SMALL_FAST_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
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
    const codexHome = join(runtimeRoot, 'home', '.codex');
    const codexConfigPath = join(codexHome, 'config.toml');
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await writeFile(
      codexConfigPath,
      [
        'model_provider = "opencode-go"',
        '',
        '[model_providers.opencode-go]',
        'name = "OpenCode Go"',
        'base_url = "https://opencode.ai/zen/go/v1"',
        'env_key = "OPENCODE_GO_API_KEY"',
        'wire_api = "responses"',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    await chmod(codexConfigPath, 0o600);
    const paseoPort = await getAvailablePort();
    paseo = await startPaseo({
      repositoryRoot: root,
      runtimeRoot,
      port: paseoPort,
      environmentVariableNames: [
        'OPENCODE_GO_API_KEY',
        'OPENCODE_CONFIG_CONTENT',
        ...anthropicEnvironmentVariableNames,
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
    PASEO_PROVIDER: requestedProvider,
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
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now()) ON CONFLICT (id) DO NOTHING',
    [workspaceId, tenantId, 'service_account', principalId, 'V2 smoke'],
  );
  const agents = {};
  for (const name of Object.values(fixtureNames)) {
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
        agents[fixtureNames.lead],
        agents[fixtureNames.member],
        agents[fixtureNames.observer],
        environment.version.id,
      ),
    },
    status: 201,
  });
  const published = await request(
    `/api/v1/team-versions/${imported.version.id}:publish`,
    { method: 'POST', body: {} },
  );
  marker('PUBLISHED_TEAM_VERSION_READY', {
    definition_id: published.definition_id,
    definition_version_id: published.id,
  });
  if (productWorkDurableIdentity)
    await runProductWorkDurableIdentityFlow({
      definitionId: published.definition_id,
      definitionVersionId: published.id,
    });
  const invoked = await request('/api/v1/tasks:invoke', {
    method: 'POST',
    status: 202,
    body: {
      invokable: { kind: 'team', version_id: published.id },
      input: {
        text: 'Compare the two bounded market-research submissions, identify any missing canonical evidence, and recommend whether each should be accepted or revised before finishing.',
      },
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
  const lead = roster.rows.find((row) => row.name === fixtureNames.lead);
  const member = roster.rows.find((row) => row.name === fixtureNames.member);
  const observer = roster.rows.find(
    (row) => row.name === fixtureNames.observer,
  );
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
    invokableVersionId: member.agent_version_id ?? agents[fixtureNames.member],
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
      name: `${fixtureNames.member}-run-fence-${suffix}`,
      role: 'member',
      agentVersionId: member.agent_version_id ?? agents[fixtureNames.member],
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
  assert(
    reworkScenario ? attempts.rowCount === 3 : attempts.rowCount === 2,
    'attempt_count_invalid',
  );
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
    `SELECT a.attempt_no,a.status AS attempt_status,r.status AS run_status,m.status AS member_status
       FROM team_work_item_attempts a
       JOIN tasks t ON t.id=a.execution_task_id
       JOIN runs r ON r.task_id=t.id
       JOIN team_member_runs m ON m.id=a.assignee_member_id
      WHERE a.team_run_id=$1 AND a.assignee_member_id=$2
      ORDER BY a.attempt_no`,
    [teamRunId, member.id],
  );
  if (scriptedRuntime) {
    if (reworkScenario)
      assert(
        memberSubmittedAttempt.rowCount === 2 &&
          memberSubmittedAttempt.rows.every(
            (row) =>
              row.attempt_status === 'completed' &&
              row.run_status === 'succeeded' &&
              row.member_status === 'idle',
          ) &&
          memberSubmittedAttempt.rows.map((row) => row.attempt_no).join(',') ===
            '1,2',
        'submitted_rework_member_not_idle',
      );
    else
      assert(
        memberSubmittedAttempt.rowCount === 1 &&
          memberSubmittedAttempt.rows[0].attempt_status === 'completed' &&
          memberSubmittedAttempt.rows[0].run_status === 'succeeded' &&
          memberSubmittedAttempt.rows[0].member_status === 'idle',
        'submitted_member_not_completed',
      );
    marker('SUBMITTED_ATTEMPT_COMPLETED');
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
  const replayByteIdentical =
    JSON.stringify(projection) === JSON.stringify(replay);
  assert(
    projection.project?.phase === 'done' &&
      projection.work_items?.length === 2 &&
      projection.gates?.finish_ready === true &&
      projection.sessions?.find(
        (session) => session.name === fixtureNames.member,
      )?.status === 'idle' &&
      direct.length === (reworkScenario ? 0 : 1) &&
      replayByteIdentical,
    'safe_projection_or_replay_invalid',
  );
  assertProjectionScannerSelfCheck();
  assertSafeProjection(projection);
  assert(Array.isArray(projection.sessions), 'sessions_projection_missing');
  const projectedTurns = projection.sessions.flatMap((session) =>
    Array.isArray(session.turns) ? session.turns : [],
  );
  const projectedTurnIds = projectedTurns.map((turn) => turn.run_id);
  assert(
    projectedTurnIds.length > 0 &&
      projectedTurnIds.every((runId) => typeof runId === 'string'),
    'projected_turns_missing',
  );
  const projectedRuntimeRows = (
    await db.query('SELECT id,runtime FROM runs WHERE id=ANY($1::uuid[])', [
      projectedTurnIds,
    ])
  ).rows;
  const runtimeByRunId = new Map(
    projectedRuntimeRows.map((row) => [row.id, row.runtime]),
  );
  const runtimeProjectionExact =
    projectedRuntimeRows.length === new Set(projectedTurnIds).size &&
    projectedTurns.every((turn) => {
      const runtime = runtimeByRunId.get(turn.run_id);
      return (
        runtime &&
        Object.hasOwn(turn, 'provider') &&
        Object.hasOwn(turn, 'model') &&
        turn.provider === runtime.provider &&
        turn.model === runtime.model
      );
    });
  assert(runtimeProjectionExact, 'projected_runtime_provider_model_mismatch');
  const runtimeLabels = new Set(
    projectedTurns.map((turn) => `${turn.provider}/${turn.model}`),
  );
  const expectedRuntimeLabels = [
    `${requestedProvider}/${requestedModel}`,
    'claude/deepseek-v4-flash',
    'codex/deepseek-v4-flash',
  ];
  assert(
    expectedRuntimeLabels.every((label) => runtimeLabels.has(label)),
    'projected_runtime_label_set_invalid',
  );
  let reworkProjectionAcceptance = true;
  if (reworkScenario) {
    const reworkItems = projection.work_items.filter(
      (item) =>
        Array.isArray(item.attempts) &&
        item.attempts.map((attempt) => attempt.attempt_no).join(',') === '1,2',
    );
    reworkProjectionAcceptance =
      reworkItems.length === 1 &&
      reworkItems[0].attempts.every((attempt) =>
        Object.hasOwn(attempt, 'feedback_summary'),
      ) &&
      reworkItems[0].latest_attempt?.attempt_no === 2;
    assert(reworkProjectionAcceptance, 'rework_projection_attempts_invalid');
  }
  const projectAcceptance =
    projection.project?.status === 'succeeded' &&
    projection.project?.phase === 'done' &&
    Object.hasOwn(projection.project, 'stop_reason') &&
    projection.project?.stop_reason === null &&
    Number.isInteger(projection.project?.revision) &&
    projection.project.revision > 0;
  assert(projectAcceptance, 'project_terminal_metadata_invalid');
  marker('CANONICAL_PROJECT_S4_ACCEPTANCE', {
    project_status_succeeded: true,
    project_phase_done: true,
    project_stop_reason_null: true,
    project_revision_positive: true,
    replay_byte_identical: replayByteIdentical,
    runtime_projection_exact: runtimeProjectionExact,
    runtime_labels: expectedRuntimeLabels,
    rework_attempts_valid: reworkProjectionAcceptance,
  });
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
      (reworkScenario
        ? leadControlProgress.rows[1].commands.includes(
            'team_work_request_changes',
          ) && leadControlProgress.rows[1].commands.includes('team_work_accept')
        : leadControlProgress.rows[1].commands.includes('team_work_accept')) &&
      leadControlProgress.rows[2].commands.includes('team_work_accept') &&
      leadControlProgress.rows[3].commands.includes('team_finish'),
    'lead_canonical_progress_receipts_invalid',
  );
  marker('LEAD_CANONICAL_PROGRESS_PROVEN');
  const directRunIds = new Set();
  let directTask = { rowCount: 0, rows: [] };
  if (!reworkScenario) {
    for (const row of (
      await db.query(
        `SELECT r.id FROM tasks t JOIN runs r ON r.task_id=t.id
          WHERE t.root_task_id=$1 AND t.team_task_kind='direct_message'`,
        [rootTaskId],
      )
    ).rows)
      directRunIds.add(row.id);
    directTask = await db.query(
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
  }
  assert(
    leadRunIds.size === 4 && memberRunIds.size === (reworkScenario ? 3 : 2),
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
    if (reworkScenario) {
      const memberBindings = bindings.filter((call) => call.role === 'member');
      const memberCreate = memberBindings.find(
        (call) =>
          call.operation === 'create' &&
          call.member_name === fixtureNames.member,
      );
      const memberContinue = memberBindings.find(
        (call) => call.operation === 'continue',
      );
      assert(
        directBindings.length === 0 &&
          memberBindings.length === 3 &&
          memberBindings.filter((call) => call.operation === 'create')
            .length === 2 &&
          memberBindings.filter((call) => call.operation === 'continue')
            .length === 1 &&
          memberCreate?.provider_binding_hash ===
            memberContinue?.provider_binding_hash,
        'rework_member_runtime_session_not_continued',
      );
    } else
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
        scriptedLeadTurns.every((call, index) => call.turn === index + 1) &&
        (reworkScenario
          ? scriptedMemberTurns.length === 3 &&
            scriptedMemberTurns.filter((call) => call.attempt === 1).length ===
              2 &&
            scriptedMemberTurns.filter((call) => call.attempt === 2).length ===
              1
          : scriptedMemberTurns.length === 2 &&
            scriptedMemberTurns.every(
              (call, index) => call.turn === index + 1,
            )),
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
        created.filter((event) => memberRunIds.has(event.runId)).length ===
          (reworkScenario ? 3 : 2) &&
        sent.filter((event) => memberRunIds.has(event.runId)).length ===
          (reworkScenario ? 3 : 2),
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
  if (reworkScenario)
    assert(deliveredDirect.rowCount === 0, 'rework_direct_delivery_present');
  else {
    assert(
      deliveredDirect.rowCount === 1 &&
        deliveredDirect.rows[0].status === 'delivered' &&
        deliveredDirect.rows[0].task_id === directTask.rows[0].task_id &&
        deliveredDirect.rows[0].run_status === 'succeeded' &&
        directRunIds.has(deliveredDirect.rows[0].run_id ?? ''),
      'direct_delivery_linkage_invalid',
    );
    marker('DIRECT_DELIVERED_AND_CONTINUED');
  }
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
  await proveRuntimeResolution();
  const finalMessageFacts = (
    await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE kind='direct')::int AS direct
         FROM team_messages WHERE team_run_id=$1`,
      [teamRunId],
    )
  ).rows[0];
  const teamWorkspaceFacts = (
    await db.query(
      `SELECT count(*)::int AS runtime_sessions,
              count(rs.paseo_workspace_id)::int AS bound_runtime_sessions,
              count(DISTINCT rs.paseo_workspace_id)::int AS distinct_paseo_workspace_ids
         FROM runtime_sessions rs
         JOIN team_member_runs member ON member.id=rs.scope_id
        WHERE rs.scope_kind='team_member' AND member.team_run_id=$1`,
      [teamRunId],
    )
  ).rows[0];
  marker('TEAM_RUN_PASEO_WORKSPACE_DURABLE_QUERY', teamWorkspaceFacts);
  const emittedToolNameFacts = (
    await db.query(
      `SELECT event.payload->>'tool_name' AS tool_name
         FROM run_events event
         JOIN runs run ON run.id=event.run_id
         JOIN tasks task ON task.id=run.task_id
        WHERE task.root_task_id=$1
          AND event.type='output'
          AND event.payload->>'kind'='tool_status'
          AND event.payload ? 'tool_name'
        ORDER BY event.sequence
        LIMIT 1`,
      [rootTaskId],
    )
  ).rows[0];
  marker('EMITTED_RUN_EVENT_TOOL_NAME_QUERY', emittedToolNameFacts ?? null);
  if (!scriptedRuntime) {
    const teamChildRunEvents = (
      await db.query(
        `SELECT run.id AS run_id,task.team_member_run_id,event.payload
           FROM runs run
           JOIN tasks task ON task.id=run.task_id
           JOIN run_events event ON event.run_id=run.id
          WHERE task.root_task_id=$1
            AND task.team_task_kind IN ('lead_turn','work_attempt','direct_message')
            AND event.type='output'
          ORDER BY run.id,event.sequence`,
        [rootTaskId],
      )
    ).rows;
    assertPaidTranscriptEvidence(teamChildRunEvents, roster.rowCount);
  }
  if (scriptedRuntime) {
    assert(
      scriptedRuntimeInstance,
      'scripted_runtime_instance_missing_for_prompt_evidence',
    );
    scriptedRuntimeInstance.emitPromptChannelEvidence();
  }
  marker('RESULT_PASS', {
    expected: {
      terminal: true,
      direct: !reworkScenario,
      dependency: true,
      replay: true,
    },
    actual: {
      terminal: true,
      direct: finalMessageFacts.direct === 1,
      dependency: true,
      replay: true,
    },
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
    if (
      !scriptedRuntime &&
      (error?.code === 'team_terminal_timeout' ||
        failure.code === 'team_terminal_timeout')
    ) {
      try {
        await captureS3S4TimeoutEvidence();
      } catch (evidenceError) {
        marker('S3_S4_TIMEOUT_EVIDENCE_FAILED', {
          s3_s4_runtime_projection_proven: false,
          known_product_blocker: 'succeeded_without_submit_absorbing',
          team_terminal: false,
          evidence_failure_code: failureCode(evidenceError),
        });
        stderr.push(
          JSON.stringify({
            evidence_error: sanitizedErrorDetail(evidenceError),
          }),
        );
      }
    }
    try {
      const persistedEnvelopeLines =
        await capturePersistedControlPlaneEnvelopeEvidence();
      if (scriptedRuntimeInstance)
        scriptedRuntimeInstance.emitPromptChannelEvidence(
          persistedEnvelopeLines,
        );
      await collectFailureDiagnostic(failure);
      await evidence('blocked', failure);
    } catch (evidenceError) {
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
