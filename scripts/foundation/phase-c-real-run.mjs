import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadRealProviderDefaults } from '../dev/real-provider-defaults.mjs';

const marker = `PHASEC_${randomBytes(16).toString('hex')}`;
const baseUrl = process.env.AGENT_SERVER_BASE_URL ?? 'http://127.0.0.1:3000';
const token = process.env.AGENT_SERVER_SERVICE_TOKEN ?? 'token-local-dev';
const output = resolve(
  process.env.FOUNDATION_PROOF_RECORD ?? '.local/phase-c/proof-record.json',
);
const defaults = loadRealProviderDefaults();
const negativeControl = process.argv.includes('--negative-control');

async function request(path, { method = 'GET', body, expected } = {}) {
  const productCommand =
    method === 'POST' &&
    (path === '/api/v1/works' || /^\/api\/v1\/works\/[^/]+\/runs$/u.test(path));
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(productCommand || method === 'GET'
        ? {}
        : { 'idempotency-key': randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  if (expected !== undefined) return { status: response.status, body: value };
  if (!response.ok)
    throw new Error(`request_failed:${path}:${response.status}:${value?.error?.code ?? 'unknown'}`);
  return value;
}

function agentSource(name, instructions) {
  const tools =
    name === 'phase-c-lead'
      ? ['team-state', 'team-work-list', 'team-work-create', 'team-work-accept-v2', 'team-finish']
      : ['team-state', 'team-work-list', 'team-work-submit'];
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}-${randomUUID().slice(0, 8)}\nspec:\n  description: Phase C external runtime proof role\n  instructions: ${JSON.stringify(instructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${tools.map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`).join('\n')}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute the next legal Team action."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

async function importAgent(name, instructions) {
  const imported = await request('/api/v1/agents:import', {
    method: 'POST',
    body: { source: agentSource(name, instructions) },
  });
  await request(`/api/v1/agent-versions/${imported.version.id}:publish`, {
    method: 'POST',
    body: {},
  });
  return imported.version.id;
}

async function waitFor(path, predicate) {
  const deadline = Date.now() + Number(process.env.PHASE_C_RUN_TIMEOUT_MS ?? 900000);
  while (Date.now() < deadline) {
    const value = await request(path);
    if (predicate(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`timeout:${path}`);
}

const environment = await request('/api/v1/environments:import', {
  method: 'POST',
  body: {
    source: `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: phase-c-${randomUUID().slice(0, 8)}\nspec:\n  adapter: paseo\n  provider: ${defaults.PASEO_PROVIDER}\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`,
  },
});
await request(`/api/v1/environment-versions/${environment.version.id}:publish`, {
  method: 'POST',
  body: {},
});
const lead = await importAgent(
  'phase-c-lead',
  `Create exactly one Work assigned to phase-c-worker. Its description must require exact marker ${marker}. Accept only a submitted result containing exactly ${marker}, then finish exactly once. Use only canonical Team tools.`,
);
const worker = await importAgent(
  'phase-c-worker',
  `Use only canonical Team tools. Complete the assigned Work and submit exactly ${marker}. Do not finish with prose before the real team_work_submit receipt succeeds.`,
);
const definitionSource = `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: phase-c-${randomUUID().slice(0, 8)}\nspec:\n  environmentVersionId: ${environment.version.id}\n  lead:\n    name: phase-c-lead\n    agentVersionId: ${lead}\n  roster:\n    - name: phase-c-worker\n      agentVersionId: ${worker}\n  coordination:\n    taskAssignment: lead_or_self_claim\n`;
const imported = await request('/api/v1/teams:import', {
  method: 'POST',
  body: { source: definitionSource },
});
const published = await request(`/api/v1/team-versions/${imported.version.id}:publish`, {
  method: 'POST',
  body: {},
});

if (negativeControl) {
  const negative = await request('/api/v1/works', {
    method: 'POST',
    expected: 400,
    body: {
      definition_id: randomUUID(),
      definition_version_id: randomUUID(),
      title: 'Phase C nonexistent definition negative control',
    },
  });
  if (negative.status < 400 || negative.status >= 500)
    throw new Error(`negative_control_unexpected_status:${negative.status}`);
  process.stdout.write(
    `${JSON.stringify({ status: 'FAIL', reason: 'nonexistent_definition', http_status: negative.status })}\n`,
  );
  process.exit(1);
}

const created = await request('/api/v1/works', {
  method: 'POST',
  body: {
    definition_id: published.definition_id,
    definition_version_id: published.id,
    title: `Phase C ${marker}`,
  },
});
const started = await request(`/api/v1/works/${created.work.id}/runs`, {
  method: 'POST',
  body: { trigger_kind: 'manual', trigger_ref: `phase-c:${marker}` },
});
const workId = created.work.id;
const workRunId = started.work_run.id;
const product = await waitFor(
  `/api/v1/works/${workId}/runs/${workRunId}`,
  (value) => value?.work_run?.product_state === 'complete',
);
const trace = await request(`/api/v1/works/${workId}/runs/${workRunId}/trace`);
if (
  product.work_run.product_state !== 'complete' ||
  product.work_run.problem_kind !== null ||
  trace.work_run?.product_state !== 'complete' ||
  trace.work_run?.problem_kind !== null
)
  throw new Error('observed_product_success_invalid');
const markerOutput = product.work_items
  .flatMap((item) => item.attempts)
  .flatMap(
    (attempt) =>
      String(attempt.result_summary ?? '').match(/PHASEC_[0-9a-f]{32}/gu) ?? [],
  )
  .find((candidate) => candidate === marker);
if (markerOutput !== marker) throw new Error('exact_marker_round_trip_failed');
if (!Array.isArray(trace.runs) || !trace.runs.length)
  throw new Error('trace_runs_missing');
const tracedRunIds = trace.runs.map((run) => run.source_refs?.run_id);
if (
  tracedRunIds.some(
    (runId) =>
      typeof runId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        runId,
      ),
  )
)
  throw new Error('trace_run_source_identity_missing');
const traceRunIds = [...new Set(tracedRunIds)].sort();
if (traceRunIds.length !== trace.runs.length)
  throw new Error('trace_run_source_identity_ambiguous');
const linkedRuns = await Promise.all(
  traceRunIds.map((runId) => request(`/api/v1/runs/${runId}`)),
);
const fetchedRunIds = linkedRuns.map((run) => run.run_id).sort();
if (
  fetchedRunIds.length !== traceRunIds.length ||
  fetchedRunIds.some((runId, index) => runId !== traceRunIds[index])
)
  throw new Error('fetched_runs_do_not_equal_trace_runs');
if (
  linkedRuns.some((run) => run.status !== 'succeeded') ||
  trace.runs.some((run) => run.status !== 'succeeded')
)
  throw new Error('trace_linked_runs_not_succeeded');
const inputTokens = linkedRuns.reduce(
  (sum, run) => sum + Number(run.usage?.input_tokens ?? 0),
  0,
);
const outputTokens = linkedRuns.reduce(
  (sum, run) => sum + Number(run.usage?.output_tokens ?? 0),
  0,
);
if (!(inputTokens > 0) || !(outputTokens > 0))
  throw new Error('positive_trace_linked_usage_missing');

const observedTerminalState =
  product.work_run.product_state === 'complete' &&
  product.work_run.problem_kind === null &&
  linkedRuns.every((run) => run.status === 'succeeded')
    ? 'succeeded'
    : null;
if (observedTerminalState !== 'succeeded')
  throw new Error('observed_terminal_state_not_succeeded');

const record = {
  schema: 'agent-server.foundation.phase-c-proof-candidate',
  version: 1,
  stage: 'raw_run_evidence',
  run_timestamp: new Date().toISOString(),
  work_id: workId,
  work_run_id: workRunId,
  terminal_state: observedTerminalState,
  observed_success: {
    product_state: product.work_run.product_state,
    problem_kind: product.work_run.problem_kind,
    trace_run_statuses: traceRunIds.map((runId) => ({
      run_id: runId,
      status: trace.runs.find((run) => run.source_refs.run_id === runId).status,
    })),
    fetched_run_statuses: linkedRuns.map((run) => ({
      run_id: run.run_id,
      status: run.status,
    })),
  },
  marker_input: marker,
  marker_output: markerOutput,
  marker_sha256: createHash('sha256').update(marker).digest('hex'),
  provider: defaults.PASEO_PROVIDER,
  model: defaults.PASEO_MODEL,
  trace_run_ids: traceRunIds,
  input_tokens: inputTokens,
  output_tokens: outputTokens,
};
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify({ status: 'PASS', output, work_id: workId, work_run_id: workRunId })}\n`);
