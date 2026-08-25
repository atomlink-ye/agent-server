#!/usr/bin/env node

// Scope: registry (Workers/environments/teams import+publish) + work identity
// + projection reachability. NOT execution: this actor does not wait for a
// terminal WorkRun state or assert provider usage.
//
// Intentional limitations:
// - workerYaml() uses tools: [], so its lead/member cannot use the Team board or
//   finish tools; this Team cannot produce useful Team work even if awaited.
// - POST /works/:id/runs omits trigger_ref. Work identity consequently assigns
//   the lead a generated UUID target (triggerRef ?? randomUUID()).

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const baseUrl = process.env.AGENT_SERVER_BASE_URL?.trim();
const token = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
const outputFile = process.env.SMOKE_OUTPUT_FILE?.trim();
const traceTimeoutMs = Number(
  process.env.TEAM_REGISTRY_TRACE_TIMEOUT_MS ?? 180_000,
);
const runId = randomUUID();

if (!baseUrl || !token || !outputFile)
  throw new Error(
    'AGENT_SERVER_BASE_URL, AGENT_SERVER_SERVICE_TOKEN, and SMOKE_OUTPUT_FILE are required',
  );

const outputPath = resolve(outputFile);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, '', 'utf8');

async function record(record) {
  await appendFile(
    outputPath,
    `${JSON.stringify({ run_id: runId, recorded_at: new Date().toISOString(), ...record })}\n`,
    'utf8',
  );
}

function endpoint(path) {
  return new URL(path, baseUrl).toString();
}

function loggedHeaders(idempotencyKey) {
  return {
    accept: 'application/json',
    authorization: '<redacted>',
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    'content-type': 'application/json',
  };
}

async function request(path, { method = 'GET', body, idempotencyKey } = {}) {
  const url = endpoint(path);
  const headers = loggedHeaders(idempotencyKey);
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  let response;
  let responseText;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
      },
      body: requestBody,
      signal: AbortSignal.timeout(15_000),
    });
    responseText = await response.text();
  } catch (error) {
    await record({
      request: { method, url, headers, body: requestBody ?? null },
      response: null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await record({
    request: { method, url, headers, body: requestBody ?? null },
    response: {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseText,
    },
  });
  let parsed;
  try {
    parsed = responseText === '' ? {} : JSON.parse(responseText);
  } catch {
    throw new Error(`${method} ${path} returned non-JSON response`);
  }
  return { status: response.status, body: parsed };
}

function expectStatus(result, expected, operation) {
  if (result.status !== expected)
    throw new Error(
      `${operation} expected HTTP ${expected}, received ${result.status}: ${JSON.stringify(result.body)}`,
    );
}

function requiredString(value, path) {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`response field ${path} must be a non-empty string`);
  return value;
}

function workerYaml(name, role) {
  return `apiVersion: agent-server/v1alpha1
kind: Worker
metadata:
  name: ${name}
spec:
  description: External actor registry validation role ${role}
  instructions: ${JSON.stringify(`Perform the ${role} role for the external actor registry validation.`)}
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: "Execute the requested role."
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: "done"
`;
}

async function importAndPublish(
  source,
  importPath,
  publishPath,
  definitionPath,
) {
  const imported = await request(importPath, {
    method: 'POST',
    body: { source },
    idempotencyKey: randomUUID(),
  });
  expectStatus(imported, 201, `import ${importPath}`);
  const versionId = requiredString(imported.body?.version?.id, 'version.id');
  const published = await request(publishPath(versionId), {
    method: 'POST',
    body: {},
    idempotencyKey: randomUUID(),
  });
  expectStatus(published, 200, `publish ${publishPath(versionId)}`);
  return {
    definitionId: requiredString(
      imported.body?.[definitionPath]?.id,
      `${definitionPath}.id`,
    ),
    versionId: requiredString(published.body?.id, 'published version.id'),
  };
}

async function importTeam(source) {
  const imported = await request('/api/v1/teams:import', {
    method: 'POST',
    body: { source },
    idempotencyKey: randomUUID(),
  });
  expectStatus(imported, 201, 'import team');
  return {
    definitionId: requiredString(imported.body?.team?.id, 'team.id'),
    versionId: requiredString(imported.body?.version?.id, 'version.id'),
  };
}

async function applyProductWorkDefinition(source) {
  const applied = await request('/api/v1/work-definitions:apply', {
    method: 'POST',
    body: { source },
    idempotencyKey: randomUUID(),
  });
  expectStatus(applied, 201, 'apply Product WorkDefinition');
  return {
    definitionId: requiredString(applied.body?.definition?.id, 'definition.id'),
    versionId: requiredString(applied.body?.version?.id, 'version.id'),
  };
}

async function publishTeam(versionId) {
  const published = await request(
    `/api/v1/team-versions/${versionId}:publish`,
    {
      method: 'POST',
      body: {},
      idempotencyKey: randomUUID(),
    },
  );
  expectStatus(published, 200, `publish Team version ${versionId}`);
  if (
    published.body?.id !== versionId ||
    published.body?.status !== 'published'
  )
    throw new Error(`Team version ${versionId} was not published`);
}

function teamYaml({
  name,
  environmentVersionId,
  leadName,
  leadWorkerVersionId,
  roster,
}) {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedTeam
metadata:
  name: ${name}
spec:
  environmentVersionId: ${environmentVersionId}
  lead:
    name: ${leadName}
    workerVersionId: ${leadWorkerVersionId}
  roster:
${roster.map(({ name: memberName, workerVersionId }) => `    - name: ${memberName}\n      workerVersionId: ${workerVersionId}`).join('\n')}
  coordination:
    taskAssignment: lead_or_self_claim
`;
}

function assertDifferentTeamSpecs(first, second) {
  const firstSpec = first.body?.spec;
  const secondSpec = second.body?.spec;
  if (JSON.stringify(firstSpec) === JSON.stringify(secondSpec))
    throw new Error('Team A and Team B GET specs must differ');
  if (firstSpec?.roster?.length === secondSpec?.roster?.length)
    throw new Error('Team A and Team B must have different roster sizes');
  if (firstSpec?.lead?.name === secondSpec?.lead?.name)
    throw new Error('Team A and Team B must have different lead roles');
}

function assertWorkerBindings(version, expectedLeadVersionId, expectedRoster) {
  const spec = version.body?.spec;
  if (spec?.lead?.workerVersionId !== expectedLeadVersionId)
    throw new Error(
      'published Team version does not pin the expected formal Worker lead',
    );
  const actualRoster = Array.isArray(spec?.roster)
    ? spec.roster.map(({ name, workerVersionId }) => ({
        name,
        workerVersionId,
      }))
    : [];
  if (JSON.stringify(actualRoster) !== JSON.stringify(expectedRoster))
    throw new Error(
      'published Team version does not pin the expected formal Worker roster',
    );
}

const suffix = runId.slice(0, 8);
const leadWorker = await importAndPublish(
  workerYaml(`external-actor-lead-${suffix}`, 'lead'),
  '/api/v1/workers:import',
  (id) => `/api/v1/worker-versions/${id}:publish`,
  'worker',
);
const memberWorker = await importAndPublish(
  workerYaml(`external-actor-member-${suffix}`, 'member'),
  '/api/v1/workers:import',
  (id) => `/api/v1/worker-versions/${id}:publish`,
  'worker',
);
const environment = await importAndPublish(
  `apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: external-actor-environment-${suffix}
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
`,
  '/api/v1/environments:import',
  (id) => `/api/v1/environment-versions/${id}:publish`,
  'definition',
);

const teamA = await importTeam(
  teamYaml({
    name: `external-actor-atlas-${suffix}`,
    environmentVersionId: environment.versionId,
    leadName: 'planner',
    leadWorkerVersionId: leadWorker.versionId,
    roster: [{ name: 'reviewer', workerVersionId: memberWorker.versionId }],
  }),
);
await publishTeam(teamA.versionId);
const teamAVersion = await request(`/api/v1/team-versions/${teamA.versionId}`);
expectStatus(teamAVersion, 200, 'get Team A version');
if (teamAVersion.body?.id !== teamA.versionId)
  throw new Error('Team A GET version id does not match imported version');
assertWorkerBindings(teamAVersion, leadWorker.versionId, [
  { name: 'reviewer', workerVersionId: memberWorker.versionId },
]);

const productWorkDefinition = await applyProductWorkDefinition(
  `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: external-actor-work-${suffix}
  description: External actor Product Work lineage validation
spec:
  kind: collaboration
  lead:
    name: planner
    worker_version_id: ${leadWorker.versionId}
  members:
    - name: reviewer
      worker_version_id: ${memberWorker.versionId}
  environment_version_id: ${environment.versionId}
  memory_version_ids: []
  input_schema:
    type: object
    properties: {}
    required: []
    additional_properties: false
`,
);
const workA = await request('/api/v1/works', {
  method: 'POST',
  body: {
    definition_id: productWorkDefinition.definitionId,
    definition_version_id: productWorkDefinition.versionId,
    title: `External actor work ${suffix}`,
  },
});
expectStatus(workA, 201, 'create Work from Team A');
if (
  workA.body?.work?.definition_id !== productWorkDefinition.definitionId ||
  workA.body?.work?.definition_version_id !== productWorkDefinition.versionId
)
  throw new Error(
    'Product Work response does not pin Product WorkDefinition lineage',
  );
const workId = requiredString(workA.body?.work?.id, 'work.id');
const startedWorkRun = await request(`/api/v1/works/${workId}/runs`, {
  method: 'POST',
  body: { trigger_kind: 'manual' },
});
expectStatus(startedWorkRun, 202, 'start Team A WorkRun');
const workRunId = requiredString(
  startedWorkRun.body?.work_run?.id,
  'work_run.id',
);
const tracePath = `/api/v1/works/${workId}/runs/${workRunId}/trace`;
const traceDeadline = Date.now() + traceTimeoutMs;
let trace;
while (Date.now() < traceDeadline) {
  const candidate = await request(tracePath);
  if (candidate.status === 200) {
    if (candidate.body?.projection_status !== 'internally_anchored')
      throw new Error(
        `trace returned HTTP 200 without an anchored projection: ${JSON.stringify(candidate.body)}`,
      );
    if (
      candidate.body?.work?.id !== workId ||
      candidate.body?.work_run?.id !== workRunId
    )
      throw new Error('trace response does not identify the requested WorkRun');
    if (
      candidate.body?.work?.definition_id !==
        productWorkDefinition.definitionId ||
      candidate.body?.work?.definition_version_id !==
        productWorkDefinition.versionId ||
      candidate.body?.work_run?.work_id !== workId ||
      candidate.body?.work_run?.definition_version_id !==
        productWorkDefinition.versionId
    )
      throw new Error(
        'formal Worker Product Work trace does not preserve Product WorkDefinition lineage',
      );
    trace = candidate;
    break;
  }
  if (
    candidate.status !== 503 ||
    candidate.body?.error?.code !== 'projection_unavailable'
  )
    throw new Error(
      `get WorkRun trace expected HTTP 200 or async 503 projection_unavailable, received ${candidate.status}: ${JSON.stringify(candidate.body)}`,
    );
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!trace)
  throw new Error(
    `WorkRun trace did not become available within ${traceTimeoutMs}ms`,
  );

const teamB = await importTeam(
  teamYaml({
    name: `external-actor-orbit-${suffix}`,
    environmentVersionId: environment.versionId,
    leadName: 'reviewer',
    leadWorkerVersionId: memberWorker.versionId,
    roster: [
      { name: 'planner', workerVersionId: leadWorker.versionId },
      { name: 'navigator', workerVersionId: memberWorker.versionId },
    ],
  }),
);
await publishTeam(teamB.versionId);
const teamBVersion = await request(`/api/v1/team-versions/${teamB.versionId}`);
expectStatus(teamBVersion, 200, 'get Team B version');
if (teamBVersion.body?.id !== teamB.versionId)
  throw new Error('Team B GET version id does not match imported version');
assertWorkerBindings(teamBVersion, memberWorker.versionId, [
  { name: 'planner', workerVersionId: leadWorker.versionId },
  { name: 'navigator', workerVersionId: memberWorker.versionId },
]);
assertDifferentTeamSpecs(teamAVersion, teamBVersion);

const teamC = await importTeam(
  teamYaml({
    name: `external-actor-unpublished-${suffix}`,
    environmentVersionId: environment.versionId,
    leadName: 'draft-planner',
    leadWorkerVersionId: leadWorker.versionId,
    roster: [
      { name: 'draft-reviewer', workerVersionId: memberWorker.versionId },
    ],
  }),
);
const teamCVersion = await request(`/api/v1/team-versions/${teamC.versionId}`);
expectStatus(teamCVersion, 200, 'get unpublished Team C version');
if (
  teamCVersion.body?.id !== teamC.versionId ||
  teamCVersion.body?.definition_id !== teamC.definitionId ||
  teamCVersion.body?.status !== 'draft'
)
  throw new Error(
    `unpublished Team C must remain a draft Team registry version, received ${JSON.stringify(teamCVersion.body)}`,
  );

await record({
  event: 'completed',
  assertions: {
    team_a_work_created: true,
    team_a_work_id: workId,
    team_a_work_run_id: workRunId,
    team_a_trace_anchored: true,
    formal_worker_team_bindings_asserted: true,
    product_work_definition_applied: true,
    product_work_definition_pinned: true,
    product_work_definition_id: productWorkDefinition.definitionId,
    product_work_definition_version_id: productWorkDefinition.versionId,
    team_a_version_read: teamA.versionId,
    team_b_version_read: teamB.versionId,
    team_a_and_b_specs_differ: true,
    unpublished_team_c_remains_draft: true,
  },
});
process.stdout.write(
  `${JSON.stringify({ outcome: 'PASS', formal_worker_registry_asserted: true, execution_asserted: false, output_file: outputPath, product_work_definition: productWorkDefinition, team_a: teamA, work_id: workId, work_run_id: workRunId, team_b: teamB, team_c: teamC })}\n`,
);
