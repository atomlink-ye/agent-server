import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capturePreIdentity,
  SUBMIT_INSTRUCTION_PROFILE,
} from './lib/capture-product-run.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFINITION_DIR = resolve(ROOT, 'fixtures/product-projection/definitions');
const SCENARIOS = new Set([
  'parallel-success',
  'rework-once',
  'lead-never-accept',
]);

function fail(code, message = '') {
  throw new Error(`${code}${message ? `:${message}` : ''}`);
}
function parseArgs(argv) {
  const allowed = new Set(['--mode', '--scenario', '--base-url']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || !value || value.startsWith('--') || parsed[name])
      fail('invalid_cli_arguments');
    parsed[name] = value;
  }
  return parsed;
}
function providerGuard() {
  const provider = process.env.PASEO_PROVIDER ?? 'opencode';
  const mode = process.env.PASEO_RUNTIME_MODE ?? '';
  const fakeMarker = process.env[`PASEO_${'FAKE'}_OK`];
  if (
    /fake|scripted|stub|mock/iu.test(provider) ||
    /fake|scripted|stub|mock/iu.test(mode) ||
    fakeMarker
  )
    fail('fake_or_scripted_provider_rejected');
  return provider;
}
async function http(baseUrl, token, path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    fail(
      `http_${response.status}`,
      body?.error?.code ?? body?.message ?? 'request_failed',
    );
  return body;
}
async function waitFor(load, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await load();
    if (predicate(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail('scenario_predicate_timeout');
}
function agentYaml(name, instructions) {
  const refs =
    name === 'projection-lead'
      ? [
          'team-state',
          'team-work-list',
          'team-work-create',
          'team-work-accept-v2',
          'team-work-request-changes',
          'team-finish',
        ]
      : ['team-state', 'team-work-list', 'team-work-submit'];
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}\nspec:\n  description: Product Projection real-run recording role\n  instructions: ${JSON.stringify(instructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${refs.map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`).join('\n')}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute the next legal Team action."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
function environmentYaml() {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: product-projection-real-run-v1\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`;
}
function scenarioInstructions(scenario, role) {
  if (role !== 'lead') {
    if (scenario === 'rework-once' && role === 'projection-worker')
      return 'Use only canonical Team tools. On attempt 1, submit exactly marker WORKER_SUBMIT_V1 and omit ACCEPTANCE_SENTINEL. After request_changes feedback, submit exactly WORKER_SUBMIT_V2 ACCEPTANCE_SENTINEL. Never repeat a successful submit.';
    if (scenario === 'rework-once' && role === 'projection-reviewer')
      return 'Use only canonical Team tools. Submit marker REVIEW_REJECT with exact blocking reason "worker attempt 1 omits ACCEPTANCE_SENTINEL". Never accept Work and never repeat a successful submit.';
    if (scenario === 'parallel-success')
      return `HARD GATE: Pure prose is invalid. You are ${role}; use only canonical Team tools. Do not end until the real canonical team_work_submit call returns a successful receipt; text does not substitute for that tool call. Complete the assigned Work, call team_work_submit exactly once successfully, and never repeat a successful submit. Scenario is ${scenario}.`;
    return `You are ${role}. Use only canonical Team tools. Complete the assigned Work and submit a concise bounded result. Scenario is ${scenario}.`;
  }
  if (scenario === 'parallel-success')
    return 'Act as lead using only canonical Team tools. Create exactly two independent Work items assigned to projection-worker-a and projection-worker-b with descriptions that each require the assignee to make the real canonical team_work_submit call and wait for its successful receipt; pure prose is invalid and text never substitutes for the call. Keep the Work items independent, wake both, accept both completed submissions, then finish exactly once. Do not use provider subagents or shell.';
  if (scenario === 'rework-once')
    return 'Act as lead using only canonical Team tools. On the empty board create exactly two independent Work items: work-1 assigned to projection-worker requiring ACCEPTANCE_SENTINEL, and work-2 assigned to projection-reviewer requiring review of that exact sentinel rule. After both first submissions, accept reviewer work, then request changes exactly once on worker work with feedback "worker attempt 1 omits ACCEPTANCE_SENTINEL". Accept worker work only when attempt 2 contains WORKER_SUBMIT_V2 ACCEPTANCE_SENTINEL, then finish exactly once. Never repeat a successful mutation.';
  return 'Act as lead using only canonical Team tools. Create one Work for worker, accept no submission, and leave the run waiting or active after the worker has submitted. Never finish or accept.';
}
function resolveDefinition(source, environmentVersionId, versions) {
  const ids = [versions.lead, ...versions.members];
  let index = 0;
  const resolved = source.replace(
    /00000000-0000-0000-0000-000000000000/gu,
    () => {
      if (index === 0) {
        index += 1;
        return environmentVersionId;
      }
      const value = ids[index - 1];
      index += 1;
      if (!value) fail('definition_agent_reference_count_mismatch');
      return value;
    },
  );
  if (/00000000-0000-0000-0000-000000000000/u.test(resolved))
    fail('definition_unresolved_uuid');
  return resolved;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args['--mode'] ?? 'pre-identity';
  const scenario = args['--scenario'] ?? 'parallel-success';
  const baseUrl =
    args['--base-url'] ??
    process.env.AGENT_SERVER_URL ??
    process.env.AGENT_SERVER_BASE_URL;
  const token =
    process.env.AGENT_SERVER_TOKEN ??
    process.env.AGENT_SERVER_SERVICE_TOKEN ??
    process.env.SERVICE_ACCOUNT_TOKEN;
  if (!['pre-identity', 'product'].includes(mode)) fail('invalid_mode');
  if (mode === 'product')
    fail(
      'product_mode_not_implemented: Product Work endpoints are not available in S0',
    );
  if (!SCENARIOS.has(scenario)) fail('invalid_scenario');
  if (!baseUrl || !token) fail('base_url_and_agent_server_token_required');
  const tenantId =
    process.env.AGENT_TENANT_ID ?? process.env.AGENT_SERVER_TENANT_ID;
  const workspaceId =
    process.env.AGENT_WORKSPACE_ID ?? process.env.AGENT_SERVER_WORKSPACE_ID;
  const principalId =
    process.env.AGENT_PRINCIPAL_ID ??
    process.env.SERVICE_ACCOUNT_ID ??
    process.env.AGENT_SERVER_SERVICE_ACCOUNT_ID;
  if (!tenantId || !workspaceId || !principalId)
    fail('authenticated_scope_environment_required');
  providerGuard();
  const url = new URL(baseUrl);
  const liveResponse = await fetch(new URL('/health/live', url));
  const live = await liveResponse.json().catch(() => null);
  if (!liveResponse.ok || live?.status !== 'ok' || !live?.version)
    fail('service_liveness_invalid');
  const readyResponse = await fetch(new URL('/health/ready', url));
  const ready = await readyResponse.json().catch(() => null);
  if (
    !readyResponse.ok ||
    ready?.status !== 'ready' ||
    !Array.isArray(ready?.checks) ||
    ready.checks.length < 3 ||
    ready.checks.some((check) => check.status !== 'ready')
  )
    fail('provider_binding_health_not_ready');
  const definitionPath = resolve(DEFINITION_DIR, `${scenario}.team.yaml`);
  const template = await readFile(definitionPath, 'utf8');
  const environment = await http(url, token, '/api/v1/environments:import', {
    method: 'POST',
    body: { source: environmentYaml() },
  });
  await http(
    url,
    token,
    `/api/v1/environment-versions/${environment.version.id}:publish`,
    { method: 'POST', body: {} },
  );
  const names =
    scenario === 'parallel-success'
      ? ['projection-worker-a', 'projection-worker-b']
      : scenario === 'rework-once'
        ? ['projection-worker', 'projection-reviewer']
        : ['projection-worker', 'projection-observer'];
  const versions = { members: [] };
  const lead = await http(url, token, '/api/v1/agents:import', {
    method: 'POST',
    body: {
      source: agentYaml(
        'projection-lead',
        scenarioInstructions(scenario, 'lead'),
      ),
    },
  });
  await http(url, token, `/api/v1/agent-versions/${lead.version.id}:publish`, {
    method: 'POST',
    body: {},
  });
  versions.lead = lead.version.id;
  for (const name of names) {
    const member = await http(url, token, '/api/v1/agents:import', {
      method: 'POST',
      body: { source: agentYaml(name, scenarioInstructions(scenario, name)) },
    });
    await http(
      url,
      token,
      `/api/v1/agent-versions/${member.version.id}:publish`,
      { method: 'POST', body: {} },
    );
    versions.members.push(member.version.id);
  }
  const source = resolveDefinition(template, environment.version.id, versions);
  const definitionHash = createHash('sha256').update(source).digest('hex');
  const imported = await http(url, token, '/api/v1/teams:import', {
    method: 'POST',
    body: { source },
  });
  const published = await http(
    url,
    token,
    `/api/v1/team-versions/${imported.version.id}:publish`,
    { method: 'POST', body: {} },
  );
  const expectedAgentVersionIds = [versions.lead, ...versions.members].sort();
  const resolvedAgentVersionIds = [
    published.spec?.lead?.agentVersionId,
    ...(published.spec?.roster ?? []).map((member) => member.agentVersionId),
  ].sort();
  if (
    published.id !== imported.version.id ||
    published.status !== 'published' ||
    published.spec?.environmentVersionId !== environment.version.id ||
    resolvedAgentVersionIds.join('\n') !== expectedAgentVersionIds.join('\n')
  )
    fail('published_definition_resolution_mismatch');
  const invocation = await http(url, token, '/api/v1/tasks:invoke', {
    method: 'POST',
    body: {
      workspace_id: workspaceId,
      invokable: { kind: 'team', version_id: published.id },
      input: {
        text: `Product Projection recording scenario ${scenario}. Execute the dedicated scenario definition exactly.`,
      },
    },
  });
  const rootTaskId = invocation.task_id;
  const timeoutMs = Number(process.env.PRODUCT_RECORD_TIMEOUT_MS ?? 180_000);
  let parallelAttemptsObserved = false;
  const project = await waitFor(
    () =>
      http(
        url,
        token,
        `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(rootTaskId)}`,
      ),
    (value) => {
      const status = value?.project?.status;
      const works = value?.work_items ?? [];
      if (
        works.filter((work) => work.latest_attempt?.status === 'running')
          .length >= 2
      )
        parallelAttemptsObserved = true;
      if (scenario === 'parallel-success')
        return (
          status === 'succeeded' &&
          works.length === 2 &&
          parallelAttemptsObserved &&
          works.every(
            (work) =>
              work.status === 'accepted' &&
              work.dependency_refs?.length === 0 &&
              work.attempts?.length === 1,
          )
        );
      if (scenario === 'rework-once')
        return (
          status === 'succeeded' &&
          works.length === 2 &&
          works.filter((work) => (work.attempts ?? []).length === 2).length ===
            1
        );
      return (
        ['waiting', 'active'].includes(status) &&
        works.some((work) => work.status === 'completed') &&
        works.every((work) => work.status !== 'accepted')
      );
    },
    timeoutMs,
  );
  const runtimes = project.sessions
    .flatMap((session) => session.turns)
    .filter((turn) => turn.provider && turn.model);
  if (!runtimes.length) fail('real_provider_runtime_evidence_missing');
  if (
    runtimes.some((turn) =>
      /fake|scripted|stub|mock/iu.test(`${turn.provider} ${turn.model}`),
    )
  )
    fail('fake_or_scripted_runtime_evidence_rejected');
  const providerKinds = [
    ...new Set(runtimes.map((turn) => turn.provider)),
  ].sort();
  const providerModels = [
    ...new Set(runtimes.map((turn) => turn.model)),
  ].sort();
  const capture = await capturePreIdentity({
    baseUrl: url,
    token,
    rootTaskId,
    tenantId,
    workspaceId,
    principalId,
    scenario,
    memberComposition: ['projection-lead', ...names],
    submitInstructionProfile: SUBMIT_INSTRUCTION_PROFILE,
    providerKind: providerKinds.join(','),
    providerModel: providerModels.join(','),
    definitionHash,
    predicateEvidence: { parallel_attempts_observed: parallelAttemptsObserved },
    project,
    serviceRevision: live.version,
    databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  });
  process.stdout.write(
    `${JSON.stringify({ provider: 'real', scenario, root_task_id: rootTaskId, work_id: { capture_status: 'not_applicable' }, work_run_id: { capture_status: 'not_applicable' }, api_files: capture.validation.api_files, db_tables: capture.validation.db_tables, predicate: project?.project?.status, recording: capture.directory, secret_hits: capture.validation.secret_hits, hash_mismatches: capture.validation.hash_mismatches })}\n`,
  );
}
main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
