import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadRealProviderDefaults } from '../dev/real-provider-defaults.mjs';
import {
  captureProductRun,
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
const realProviderDefaults = loadRealProviderDefaults();

function fail(code, message = '') {
  throw new Error(`${code}${message ? `:${message}` : ''}`);
}
function parseArgs(argv) {
  const allowed = new Set([
    '--mode',
    '--scenario',
    '--base-url',
    '--work-run-id',
  ]);
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
  const provider =
    process.env.PASEO_PROVIDER ?? realProviderDefaults.PASEO_PROVIDER;
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
  const headers = {
    ...(options.technicalIdempotency === false
      ? {}
      : { 'idempotency-key': randomUUID() }),
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers,
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
function agentYaml(name, instructions, packageName = name) {
  const refs =
    name === 'projection-lead'
      ? [
          'team-state',
          'team-work-list',
          'team-message-send',
          'team-work-create',
          'team-work-accept-v2',
          'team-work-request-changes',
          'team-finish',
        ]
      : ['team-state', 'team-work-list', 'team-work-submit'];
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${packageName}\nspec:\n  description: Product Projection real-run recording role\n  instructions: ${JSON.stringify(instructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${refs.map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`).join('\n')}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute the next legal Team action."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}
function nonblank(value) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}
function attemptField(attempt, ...names) {
  for (const name of names) {
    if (attempt?.[name] !== undefined) return attempt[name];
  }
  return null;
}
function parallelPredicateEvidence(works) {
  return (Array.isArray(works) ? works : []).map((work) => {
    const attempts = Array.isArray(work?.attempts) ? work.attempts : [];
    return {
      work_id: attemptField(work, 'id', 'work_id', 'work_ref'),
      attempt_count: attempts.length,
      attempts: attempts.map((attempt) => ({
        attempt_no: attemptField(
          attempt,
          'attempt_no',
          'attemptNo',
          'attempt_number',
          'attemptNumber',
        ),
        status: attemptField(
          attempt,
          'status',
          'attempt_status',
          'attemptStatus',
        ),
      })),
      request_changes_observed: attempts.some((attempt) =>
        nonblank(attemptField(attempt, 'feedbackSummary', 'feedback_summary')),
      ),
    };
  });
}
function environmentYaml(provider) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: product-projection-real-run-v1\nspec:\n  adapter: paseo\n  provider: ${provider}\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`;
}
function scenarioInstructions(scenario, role, mode) {
  if (role !== 'lead') {
    if (scenario === 'rework-once' && role === 'projection-worker')
      return 'Use only canonical Team tools. On attempt 1, submit exactly marker WORKER_SUBMIT_V1 and omit ACCEPTANCE_SENTINEL. After request_changes feedback, submit exactly WORKER_SUBMIT_V2 ACCEPTANCE_SENTINEL. Never repeat a successful submit.';
    if (scenario === 'rework-once' && role === 'projection-reviewer')
      return 'Use only canonical Team tools. Submit marker REVIEW_REJECT with exact blocking reason "worker attempt 1 omits ACCEPTANCE_SENTINEL". Never accept Work and never repeat a successful submit.';
    if (scenario === 'parallel-success' || mode === 'state-canary')
      return `HARD GATE: Pure prose is invalid. You are ${role}; use only canonical Team tools. Do not end until the real canonical team_work_submit call returns a successful receipt; text does not substitute for that tool call. Complete the assigned Work, call team_work_submit exactly once successfully, and never repeat a successful submit. Scenario is ${scenario}.`;
    if (scenario === 'lead-never-accept')
      return `HARD GATE: Pure prose is invalid. You are ${role}; use only canonical Team tools. Complete the assigned Work, call team_work_submit exactly once, and do not end until that real call returns a successful receipt. Never repeat a successful submit.`;
    return `You are ${role}. Use only canonical Team tools. Complete the assigned Work and submit a concise bounded result. Scenario is ${scenario}.`;
  }
  if (scenario === 'parallel-success')
    return 'Act as lead using only canonical Team tools. HARD CARDINALITY GATE: the final board must contain exactly two Work items total, never three. Inspect the initially empty board, call team_work_create exactly twice total—once for projection-worker-a and once for projection-worker-b—and never call team_work_create again after those two receipts. Make the two Work items independent, with descriptions that each require the assignee to make the real canonical team_work_submit call and wait for its successful receipt; pure prose is invalid and text never substitutes for the call. Wake both, accept both completed submissions, verify the board still contains exactly two accepted Work items, then finish exactly once. Do not use provider subagents or shell.';
  if (scenario === 'rework-once')
    return 'Act as lead using only canonical Team tools. On the empty board create exactly two independent Work items: work-1 assigned to projection-worker requiring ACCEPTANCE_SENTINEL, and work-2 assigned to projection-reviewer requiring review of that exact sentinel rule. After both first submissions, accept reviewer work, then request changes exactly once on worker work with feedback "worker attempt 1 omits ACCEPTANCE_SENTINEL". Accept worker work only when attempt 2 contains WORKER_SUBMIT_V2 ACCEPTANCE_SENTINEL, then finish exactly once. Never repeat a successful mutation.';
  if (mode === 'state-canary')
    return 'Act as lead using only canonical Team tools. HARD CARDINALITY GATE: create exactly two independent Work items total, one assigned to projection-worker-a and one to projection-worker-b. Each description must require the assignee to make the real canonical team_work_submit call and wait for its successful receipt; pure prose is invalid. Wake both members. Accept no submission, request no changes, cancel nothing, and never call team_finish. If exactly one member has submitted, send exactly one canonical direct message to the unfinished member telling it to complete and submit; this is required durable progress for that Lead turn. After both members have submitted, make no further mutation and leave the Team active.';
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
  if (!['pre-identity', 'product', 'state-canary'].includes(mode))
    fail('invalid_mode');
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
  const provider = providerGuard();
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
  const packageSuffix =
    mode === 'state-canary' ? `-${randomUUID().slice(0, 8)}` : '';
  const definitionPath = resolve(
    DEFINITION_DIR,
    `${mode === 'state-canary' ? 'parallel-success' : scenario}.team.yaml`,
  );
  let template = await readFile(definitionPath, 'utf8');
  if (mode === 'state-canary') {
    template = template.replace(
      'name: product-projection-parallel-success-v1',
      `name: product-projection-state-honesty${packageSuffix}`,
    );
  }
  const environment = await http(url, token, '/api/v1/environments:import', {
    method: 'POST',
    body: { source: environmentYaml(provider) },
  });
  await http(
    url,
    token,
    `/api/v1/environment-versions/${environment.version.id}:publish`,
    { method: 'POST', body: {} },
  );
  const names =
    mode === 'state-canary'
      ? ['projection-worker-a', 'projection-worker-b']
      : scenario === 'parallel-success'
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
        scenarioInstructions(scenario, 'lead', mode),
        `projection-lead${packageSuffix}`,
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
      body: {
        source: agentYaml(
          name,
          scenarioInstructions(scenario, name, mode),
          `${name}${packageSuffix}`,
        ),
      },
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
  let productContext = null;
  let rootTaskId;
  if (mode === 'product') {
    const created = await http(url, token, '/api/v1/works', {
      method: 'POST',
      technicalIdempotency: false,
      body: {
        definition_id: published.definition_id,
        definition_version_id: published.id,
        title: `Product Projection ${scenario} ${randomUUID().slice(0, 8)}`,
      },
    });
    const started = await http(
      url,
      token,
      `/api/v1/works/${created.work.id}/runs`,
      {
        method: 'POST',
        technicalIdempotency: false,
        body: {
          trigger_kind: 'manual',
          trigger_ref: `product-projection:${scenario}:${randomUUID()}`,
        },
      },
    );
    rootTaskId = started.execution_receipt?.source_refs?.task_id;
    if (!rootTaskId) fail('product_execution_receipt_task_id_missing');
    productContext = { created, started };
  } else {
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
    rootTaskId = invocation.task_id;
  }
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
          works.every((work) => {
            const attempts = Array.isArray(work.attempts) ? work.attempts : [];
            return (
              work.status === 'accepted' &&
              work.dependency_refs?.length === 0 &&
              attempts.length >= 1 &&
              !attempts.some((attempt) =>
                nonblank(
                  attemptField(attempt, 'feedbackSummary', 'feedback_summary'),
                ),
              )
            );
          })
        );
      if (scenario === 'rework-once')
        return (
          status === 'succeeded' &&
          works.length === 2 &&
          works.filter((work) => (work.attempts ?? []).length === 2).length ===
            1
        );
      if (mode === 'state-canary')
        return (
          status === 'active' &&
          value?.stuck === true &&
          value?.gates?.no_active_attempts === true &&
          value?.gates?.all_members_idle === true &&
          value?.gates?.all_work_accepted === false &&
          works.length === 2 &&
          works.every(
            (work) =>
              work.status === 'completed' &&
              work.latest_attempt?.status === 'completed',
          )
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
  if (mode === 'state-canary') {
    await proveStateHonestyCanary({
      baseUrl: url,
      token,
      project,
      tenantId,
      workspaceId,
      principalId,
      principalType: process.env.AGENT_PRINCIPAL_TYPE ?? 'service_account',
      databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
    });
    return;
  }
  const providerKinds = [
    ...new Set(runtimes.map((turn) => turn.provider)),
  ].sort();
  const providerModels = [
    ...new Set(runtimes.map((turn) => turn.model)),
  ].sort();
  if (mode === 'product') {
    const workId = productContext.created.work.id;
    const workRunId =
      args['--work-run-id'] ?? productContext.started.work_run.id;
    const product = await waitFor(
      () =>
        http(url, token, `/api/v1/works/${workId}/runs/${workRunId}`, {
          technicalIdempotency: false,
        }),
      (value) =>
        value?.projection_status === 'internally_anchored' &&
        value?.work_run?.id === workRunId,
      timeoutMs,
    );
    const trace = await http(
      url,
      token,
      `/api/v1/works/${workId}/runs/${workRunId}/trace`,
      { technicalIdempotency: false },
    );
    if (scenario === 'parallel-success') {
      const activities = trace?.mcp_activities;
      if (!Array.isArray(activities) || activities.length < 1)
        fail('parallel_mcp_activities_missing');
      if (
        activities.some(
          (activity) =>
            activity.provenance !== 'server_authorized_team_mcp_catalog',
        )
      )
        fail('parallel_mcp_provenance_invalid');
    }
    const capture = await captureProductRun({
      baseUrl: url,
      token,
      rootTaskId,
      workId,
      workRunId,
      work: product.work,
      workRun: product.work_run,
      trace,
      tenantId,
      workspaceId,
      principalId,
      scenario,
      memberComposition: ['projection-lead', ...names],
      submitInstructionProfile: SUBMIT_INSTRUCTION_PROFILE,
      providerKind: providerKinds.join(','),
      providerModel: providerModels.join(','),
      definitionHash,
      predicateEvidence: {
        parallel_attempts_observed: parallelAttemptsObserved,
        ...(scenario === 'parallel-success'
          ? {
              parallel_work_attempts: parallelPredicateEvidence(
                project?.work_items,
              ),
            }
          : {}),
      },
      serviceRevision: live.version,
      databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
      outputRoot: process.env.PRODUCT_RECORDINGS_ROOT,
    });
    process.stdout.write(
      `${JSON.stringify({ provider: 'real', mode, scenario, root_task_id: rootTaskId, work_id: workId, work_run_id: workRunId, recording: capture.directory, secret_hits: capture.validation.secret_hits, hash_mismatches: capture.validation.hash_mismatches })}\n`,
    );
    return;
  }
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
    predicateEvidence: {
      parallel_attempts_observed: parallelAttemptsObserved,
      ...(scenario === 'parallel-success'
        ? {
            parallel_work_attempts: parallelPredicateEvidence(
              project?.work_items,
            ),
          }
        : {}),
    },
    project,
    serviceRevision: live.version,
    databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
    outputRoot: process.env.PRODUCT_RECORDINGS_ROOT,
  });
  process.stdout.write(
    `${JSON.stringify({ provider: 'real', scenario, root_task_id: rootTaskId, work_id: { capture_status: 'not_applicable' }, work_run_id: { capture_status: 'not_applicable' }, api_files: capture.validation.api_files, db_tables: capture.validation.db_tables, predicate: project?.project?.status, recording: capture.directory, secret_hits: capture.validation.secret_hits, hash_mismatches: capture.validation.hash_mismatches })}\n`,
  );
}

async function proveStateHonestyCanary(input) {
  if (!input.databaseUrl) fail('state_canary_database_url_required');
  if (input.project?.stuck !== true) fail('state_canary_stuck_not_true');
  if (input.project?.decision_capture_status !== 'not_captured')
    fail('state_canary_decision_capture_status_not_honest');
  if (Object.hasOwn(input.project ?? {}, 'decisions'))
    fail('state_canary_not_captured_exposes_decisions');
  const teamRunId = input.project?.project?.team_run_id;
  if (!teamRunId) fail('state_canary_team_run_id_missing');

  const pool = new pg.Pool({ connectionString: input.databaseUrl });
  try {
    const stuckResult = await pool.query(
      `SELECT tr.id AS team_run_id,
              tr.status AS team_status,
              NOT EXISTS (
                SELECT 1 FROM team_work_item_attempts active_attempt
                 WHERE active_attempt.team_run_id=tr.id
                   AND active_attempt.status IN ('queued','running')
              ) AS no_active_attempts,
              NOT EXISTS (
                SELECT 1 FROM team_member_runs member
                 WHERE member.team_run_id=tr.id
                   AND member.role='member'
                   AND member.status NOT IN ('idle','stopped')
              ) AS all_members_idle,
              EXISTS (
                SELECT 1 FROM team_work_items any_work
                 WHERE any_work.team_run_id=tr.id
              ) AND NOT EXISTS (
                SELECT 1 FROM team_work_items unaccepted_work
                 WHERE unaccepted_work.team_run_id=tr.id
                   AND unaccepted_work.status<>'accepted'
              ) AS all_work_accepted,
              attempt.id AS attempt_id,
              work.status AS work_status,
              technical_run.id AS technical_run_id,
              attempt.status='completed'
                AND technical_run.status='succeeded'
                AND length(trim(coalesce(attempt.result_summary,'')))>0
                AS canonical_submit_committed,
              (SELECT count(*)::integer FROM run_events event
                WHERE event.run_id=technical_run.id) AS run_events_count
         FROM team_runs tr
         JOIN team_work_item_attempts attempt
           ON attempt.team_run_id=tr.id AND attempt.status='completed'
         JOIN team_work_items work
           ON work.id=attempt.work_item_id AND work.status<>'accepted'
         JOIN LATERAL (
           SELECT run.id,run.status
             FROM runs run
            WHERE run.task_id=attempt.execution_task_id
            ORDER BY run.attempt DESC,run.id DESC
            LIMIT 1
         ) technical_run ON true
        WHERE tr.id=$1
          AND tr.tenant_id=$2 AND tr.workspace_id=$3
          AND tr.principal_type=$4 AND tr.principal_id=$5
        ORDER BY attempt.attempt_no DESC,attempt.id DESC
        LIMIT 1`,
      [
        teamRunId,
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
    const stuck = stuckResult.rows[0];
    if (!stuck) fail('state_canary_submitted_unaccepted_attempt_missing');
    if (stuck.team_status !== 'active') fail('state_canary_team_not_active');
    if (stuck.no_active_attempts !== true)
      fail('state_canary_active_attempt_gate_not_clear');
    if (stuck.all_members_idle !== true)
      fail('state_canary_member_idle_gate_not_clear');
    if (stuck.all_work_accepted !== false)
      fail('state_canary_acceptance_gate_not_blocked');
    if (stuck.canonical_submit_committed !== true)
      fail('state_canary_canonical_submit_not_committed');
    if (!(stuck.run_events_count > 0)) fail('state_canary_run_events_missing');
    const apiGates = input.project.gates;
    if (
      apiGates?.no_active_attempts !== stuck.no_active_attempts ||
      apiGates?.all_members_idle !== stuck.all_members_idle ||
      apiGates?.all_work_accepted !== stuck.all_work_accepted
    )
      fail('state_canary_api_db_gate_mismatch');

    const normalResult = await pool.query(
      `SELECT id AS team_run_id,root_task_id
         FROM team_runs
        WHERE tenant_id=$1 AND workspace_id=$2
          AND principal_type=$3 AND principal_id=$4
          AND status='succeeded'
        ORDER BY updated_at DESC,id DESC
        LIMIT 1`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
      ],
    );
    const normal = normalResult.rows[0];
    if (!normal) fail('state_canary_normal_run_missing');
    const normalProject = await http(
      input.baseUrl,
      input.token,
      `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(normal.root_task_id)}`,
    );
    if (normalProject?.stuck !== false)
      fail('state_canary_normal_run_stuck_not_false');
    if (normalProject?.decision_capture_status !== 'not_captured')
      fail('state_canary_normal_decision_capture_status_not_honest');
    if (Object.hasOwn(normalProject ?? {}, 'decisions'))
      fail('state_canary_normal_not_captured_exposes_decisions');

    process.stdout.write(
      `${JSON.stringify({
        marker: 'PRODUCT_RUN_STATE_HONESTY_PASS',
        team_run_id: stuck.team_run_id,
        attempt_id: stuck.attempt_id,
        technical_run_id: stuck.technical_run_id,
        gates: {
          no_active_attempts: stuck.no_active_attempts,
          all_members_idle: stuck.all_members_idle,
          all_work_accepted: stuck.all_work_accepted,
        },
        work_status: stuck.work_status,
        canonical_submit_committed: stuck.canonical_submit_committed,
        run_events_count: stuck.run_events_count,
        stuck: true,
        normal_team_run_id: normal.team_run_id,
        normal_stuck: normalProject.stuck,
        decision_capture_status: input.project.decision_capture_status,
        decisions_present: Object.hasOwn(input.project, 'decisions'),
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
