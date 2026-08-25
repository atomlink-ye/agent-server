#!/usr/bin/env node

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { loadRealProviderDefaults } from '../dev/real-provider-defaults.mjs';

const defaults = loadRealProviderDefaults();
const baseUrl = process.env.AGENT_SERVER_BASE_URL?.trim();
const token = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
const timeoutMs = Number(
  process.env.USER_DEFINED_TEAM_WORK_LIFECYCLE_TIMEOUT_MS ?? 420_000,
);
const defaultWorkspaceId = '00000000-0000-4000-8000-000000000001';
const agentServerWorkspaceId =
  process.env.AGENT_SERVER_WORKSPACE_ID?.trim() ?? defaultWorkspaceId;
const webWorkspaceId =
  process.env.WEB_WORKSPACE_ID?.trim() ?? defaultWorkspaceId;
const completionApprovalRaw =
  process.env.AGENT_SERVER_TEAM_COMPLETION_APPROVAL_REQUIRED?.trim() ?? 'false';
const completionApprovalRequired = ['true', '1'].includes(
  completionApprovalRaw.toLowerCase(),
);
const validCompletionApprovalValue = ['true', 'false', '1', '0'].includes(
  completionApprovalRaw.toLowerCase(),
);
const startedAt = Date.now();
const scenarioId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const configuredOutputFile = process.env.SMOKE_OUTPUT_FILE?.trim();
const transcriptPath = configuredOutputFile
  ? resolve(configuredOutputFile)
  : join(
      process.cwd(),
      '.local',
      'test-runs',
      `user-defined-team-work-lifecycle-${scenarioId}`,
      'http-transcript.jsonl',
    );
const transcriptDirectory = dirname(transcriptPath);

if (!baseUrl || !token) {
  throw new Error(
    'AGENT_SERVER_BASE_URL and AGENT_SERVER_SERVICE_TOKEN are required',
  );
}
if (!validCompletionApprovalValue) {
  throw new Error(
    `AGENT_SERVER_TEAM_COMPLETION_APPROVAL_REQUIRED must be true, false, 1, or 0; received ${JSON.stringify(completionApprovalRaw)}`,
  );
}
if (completionApprovalRequired) {
  throw new Error(
    'AGENT_SERVER_TEAM_COMPLETION_APPROVAL_REQUIRED must be false: the Product Work lifecycle has no completion approval command',
  );
}
if (agentServerWorkspaceId !== webWorkspaceId) {
  throw new Error(
    `workspace configuration mismatch: AGENT_SERVER_WORKSPACE_ID=${agentServerWorkspaceId} WEB_WORKSPACE_ID=${webWorkspaceId}`,
  );
}

function expectedRuntimeModel(provider, model) {
  const prefix = 'opencode-go/';
  const stripsProviderPrefix = provider === 'claude' || provider === 'codex';
  return stripsProviderPrefix && model.startsWith(prefix)
    ? model.slice(prefix.length)
    : model;
}

function progress(stage, details = {}) {
  process.stdout.write(
    `${JSON.stringify({
      event: 'user_defined_team_work_lifecycle_progress',
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      stage,
      ...details,
    })}\n`,
  );
}

function recordHttpTranscript(entry) {
  mkdirSync(transcriptDirectory, { recursive: true });
  appendFileSync(
    transcriptPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(
  path,
  {
    method = 'GET',
    body,
    expectedStatus,
    idempotency = false,
    allowStatuses,
  } = {},
) {
  const idempotencyKey = idempotency
    ? `user-defined-team-work-lifecycle-${scenarioId}-${Math.random().toString(36).slice(2, 10)}`
    : undefined;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} returned invalid JSON`);
    }
  }
  recordHttpTranscript({
    request: { method, path, ...(body === undefined ? {} : { body }) },
    response: { status: response.status, body: json },
  });
  if (allowStatuses?.includes(response.status)) {
    return { status: response.status, body: json };
  }
  if (
    expectedStatus === undefined
      ? !response.ok
      : response.status !== expectedStatus
  ) {
    throw new Error(
      `${method} ${path} -> ${response.status} ${JSON.stringify(json)}`,
    );
  }
  return json;
}

async function importAndPublish(source, importPath, publishPath) {
  const imported = await request(importPath, {
    method: 'POST',
    body: { source },
    expectedStatus: 201,
    idempotency: true,
  });
  const published = await request(publishPath(imported.version.id), {
    method: 'POST',
    body: {},
    expectedStatus: 200,
    idempotency: true,
  });
  return { imported, published };
}

async function pollWorkRun(workId, workRunId) {
  const deadline = Date.now() + timeoutMs;
  let lastState;
  while (Date.now() < deadline) {
    const observed = await request(
      `/api/v1/works/${workId}/runs/${workRunId}`,
      { allowStatuses: [200, 503] },
    );
    if (observed.status === 503) {
      if (observed.body?.error?.code !== 'projection_unavailable') {
        throw new Error(
          `unexpected projection 503: ${JSON.stringify(observed.body)}`,
        );
      }
      progress('projection_unavailable');
      await pause(1_000);
      continue;
    }
    const projection = observed.body;
    const state = projection.work_run?.product_state;
    if (state !== lastState) {
      progress('work_run_projection', {
        work_run_id: workRunId,
        product_state: state,
      });
      lastState = state;
    }
    if (state === 'running') {
      await pause(1_000);
      continue;
    }
    if (state === 'needs_you') {
      throw new Error(
        'WorkRun reached needs_you: the Product Work lifecycle has no completion approval command',
      );
    }
    if (['complete', 'problem', 'not_captured'].includes(state)) {
      return projection;
    }
    throw new Error(
      `WorkRun returned an unknown product_state: ${JSON.stringify(projection.work_run)}`,
    );
  }
  throw new Error('work_run_projection_timeout');
}

const leadSource = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: smoke-lead
spec:
  description: Canonical Agent Team smoke role
  instructions: 'Act as Team Lead using only canonical Team tools. Use board_list to read the board first. If no Work exists, use board_create to create exactly one Work assigned to analyst with subject "Return smoke marker" and description "Submit exactly AGENT_TEAM_SMOKE_MEMBER_OK", then stop. If the analyst Work is completed, use board_accept to accept it. When every Work is accepted and no active attempt remains, call collaboration_finish exactly once. Never create duplicate Work and never substitute prose for a required Team mutation.'
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
    prompt: "Execute exactly the next legal Team transition for your role."
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

const analystSource = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: smoke-analyst
spec:
  description: Canonical Agent Team smoke role
  instructions: 'Act as the assigned Team member using canonical Team tools. Use board_list to read the board, locate your active Work, and use board_submit to submit it exactly once with result summary AGENT_TEAM_SMOKE_MEMBER_OK. Do not create Work, accept Work, finish the Team, use provider subagents, or emit unrelated prose.'
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
    prompt: "Execute exactly the next legal Team transition for your role."
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

async function main() {
  progress('configuration_verified', {
    AGENT_SERVER_WORKSPACE_ID: agentServerWorkspaceId,
    WEB_WORKSPACE_ID: webWorkspaceId,
    AGENT_SERVER_TEAM_COMPLETION_APPROVAL_REQUIRED: completionApprovalRequired,
  });
  progress('started', {
    provider: defaults.PASEO_PROVIDER,
    model: defaults.PASEO_MODEL,
    product_path: 'teams:import -> publish -> works -> runs -> trace',
    transcript_path: transcriptPath,
  });

  const lead = await importAndPublish(
    leadSource,
    '/api/v1/agents:import',
    (id) => `/api/v1/agent-versions/${id}:publish`,
  );
  const analyst = await importAndPublish(
    analystSource,
    '/api/v1/agents:import',
    (id) => `/api/v1/agent-versions/${id}:publish`,
  );
  const environment = await importAndPublish(
    `apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: user-work-lifecycle-environment-${scenarioId}
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
`,
    '/api/v1/environments:import',
    (id) => `/api/v1/environment-versions/${id}:publish`,
  );

  const importedTeam = await request('/api/v1/teams:import', {
    method: 'POST',
    body: {
      source: `apiVersion: agent-server/v1alpha1
kind: ManagedTeam
metadata:
  name: user-work-lifecycle-team-${scenarioId}
spec:
  environmentVersionId: ${environment.published.id}
  lead:
    name: lead
    agentVersionId: ${lead.published.id}
  roster:
    - name: analyst
      agentVersionId: ${analyst.published.id}
  coordination:
    taskAssignment: lead_or_self_claim
`,
    },
    expectedStatus: 201,
    idempotency: true,
  });
  const draftVersionId = importedTeam.version.id;
  const teamId = importedTeam.team.id;
  progress('team_imported_draft', {
    team_id: teamId,
    version_id: draftVersionId,
  });

  const unpublishedRejected = await request('/api/v1/works', {
    method: 'POST',
    body: {
      definition_id: teamId,
      definition_version_id: draftVersionId,
      title: 'Draft Team must not be runnable',
    },
    expectedStatus: 400,
  });
  if (unpublishedRejected?.error?.code !== 'invalid_work_definition') {
    throw new Error(
      `draft team mutation did not reject correctly: ${JSON.stringify(unpublishedRejected)}`,
    );
  }
  progress('unpublished_team_version_rejected', {
    status: 400,
    error_code: unpublishedRejected.error.code,
  });

  const publishedTeam = await request(
    `/api/v1/team-versions/${draftVersionId}:publish`,
    { method: 'POST', body: {}, expectedStatus: 200, idempotency: true },
  );
  if (publishedTeam.status !== 'published') {
    throw new Error(
      `team version did not publish: ${JSON.stringify(publishedTeam)}`,
    );
  }
  progress('team_version_published', {
    team_id: teamId,
    version_id: publishedTeam.id,
  });

  const createdWork = await request('/api/v1/works', {
    method: 'POST',
    body: {
      definition_id: teamId,
      definition_version_id: publishedTeam.id,
      title: 'Run user-defined Team through Product Work lifecycle',
    },
    expectedStatus: 201,
  });
  const workId = createdWork.work?.id;
  if (typeof workId !== 'string')
    throw new Error('Work response did not contain id');
  progress('work_created', {
    work_id: workId,
    definition_version_id: publishedTeam.id,
  });

  const startedWorkRun = await request(`/api/v1/works/${workId}/runs`, {
    method: 'POST',
    body: {
      trigger_kind: 'manual',
      trigger_ref:
        'Complete the canonical one-member Team smoke and return AGENT_TEAM_SMOKE_MEMBER_OK.',
    },
    expectedStatus: 202,
  });
  const workRunId = startedWorkRun.work_run?.id;
  if (typeof workRunId !== 'string')
    throw new Error('WorkRun response did not contain id');
  progress('work_run_started', {
    work_id: workId,
    work_run_id: workRunId,
    root_task_id: startedWorkRun.execution_receipt?.source_refs?.task_id,
  });

  const projection = await pollWorkRun(workId, workRunId);
  if (projection.work_run?.product_state !== 'complete') {
    throw new Error(
      `WorkRun did not complete: ${JSON.stringify(projection.work_run)}`,
    );
  }

  const trace = await request(
    `/api/v1/works/${workId}/runs/${workRunId}/trace`,
    { expectedStatus: 200 },
  );
  const traceRuns = Array.isArray(trace.runs) ? trace.runs : [];
  const providerRunIds = traceRuns
    .filter((record) => record.provider !== null && record.model !== null)
    .map((record) => record.source_refs?.run_id)
    .filter((id) => typeof id === 'string');
  const orchestrationRecordsSkipped = traceRuns.length - providerRunIds.length;
  if (providerRunIds.length === 0)
    throw new Error('trace contained no provider execution records');

  const usage = { input_tokens: 0, output_tokens: 0, total_cost_usd: 0 };
  const runtimeModels = new Set();
  let nullUsageRecordsSkipped = 0;
  for (const runId of providerRunIds) {
    const run = await request(`/api/v1/runs/${encodeURIComponent(runId)}`, {
      expectedStatus: 200,
    });
    if (!run.usage || typeof run.usage !== 'object') {
      nullUsageRecordsSkipped += 1;
      continue;
    }
    if (run.runtime?.provider && run.runtime?.model) {
      runtimeModels.add(`${run.runtime.provider}/${run.runtime.model}`);
    }
    for (const field of Object.keys(usage)) {
      const value = run.usage[field];
      if (typeof value === 'number' && Number.isFinite(value))
        usage[field] += value;
    }
  }
  const expectedRuntime = `${defaults.PASEO_PROVIDER}/${expectedRuntimeModel(
    defaults.PASEO_PROVIDER,
    defaults.PASEO_MODEL,
  )}`;
  if (
    !(usage.input_tokens > 0) ||
    !(usage.output_tokens > 0) ||
    !(usage.total_cost_usd > 0) ||
    !runtimeModels.has(expectedRuntime)
  ) {
    throw new Error(
      `real provider usage assertion failed: ${JSON.stringify({ usage, runtime_models: [...runtimeModels], expected_runtime: expectedRuntime })}`,
    );
  }
  progress('trace_usage_asserted', {
    trace_run_count: traceRuns.length,
    orchestration_records_skipped: orchestrationRecordsSkipped,
    provider_run_count: providerRunIds.length,
    null_usage_records_skipped: nullUsageRecordsSkipped,
    runtime_models: [...runtimeModels],
    usage,
  });
  process.stdout.write(
    `${JSON.stringify({
      outcome: 'PASS',
      work_id: workId,
      work_run_id: workRunId,
      product_state: projection.work_run.product_state,
      trace_run_count: traceRuns.length,
      orchestration_records_skipped: orchestrationRecordsSkipped,
      null_usage_records_skipped: nullUsageRecordsSkipped,
      runtime_models: [...runtimeModels],
      usage,
      duration_ms: Date.now() - startedAt,
      transcript_path: transcriptPath,
    })}\n`,
  );
}

await main();
