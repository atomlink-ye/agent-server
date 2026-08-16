// A green result proves canonical collaboration primitives work end-to-end with
// a real provider: work_available and final_review provenance exist, a
// requires-ack direct message completes a round trip and materializes a
// participant turn, and two Work items are accepted with one rework.
//
// It does not prove Agent autonomous, flexible collaboration. The fixture
// instructions are still a literal script, so green means the Agent followed
// that script and the pipeline worked. Reading this green result as proof that
// “C capability is established” is incorrect.
import { randomUUID } from 'node:crypto';
import {
  classifySmokeOutcome,
  formatSmokeOutcome,
} from './agent-team-completion-line.mjs';
import { loadRealProviderDefaults } from '../dev/real-provider-defaults.mjs';

const realProviderDefaults = loadRealProviderDefaults();
const baseUrl = process.env.AGENT_SERVER_BASE_URL?.trim();
const token = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
const workspaceId =
  process.env.AGENT_SERVER_WORKSPACE_ID?.trim() ??
  '00000000-0000-4000-8000-000000000001';
const timeoutMs = Number(process.env.AGENT_TEAM_SMOKE_TIMEOUT_MS ?? 300_000);
const startedAt = Date.now();
const progressIntervalMs = 5_000;

function progress(stage, details = {}) {
  process.stdout.write(
    `${JSON.stringify({
      event: 'agent_team_smoke_progress',
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      stage,
      ...details,
    })}\n`,
  );
}

function usageSummary(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const fields = ['input_tokens', 'output_tokens', 'total_cost_usd'];
  const summary = Object.fromEntries(
    fields
      .filter((field) => Number.isFinite(usage[field]))
      .map((field) => [field, usage[field]]),
  );
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function outputSummary(text) {
  return typeof text === 'string' ? text.slice(0, 512) : undefined;
}

function projectionSummary(value) {
  const project = value?.project;
  return {
    project: project
      ? {
          status: project.status ?? null,
          phase: project.phase ?? null,
          revision: project.revision ?? null,
          stop_reason: project.stop_reason ?? null,
        }
      : null,
    gates: value?.gates
      ? {
          finish_ready: value.gates.finish_ready ?? null,
          all_work_accepted: value.gates.all_work_accepted ?? null,
          no_active_attempts: value.gates.no_active_attempts ?? null,
          all_members_idle: value.gates.all_members_idle ?? null,
        }
      : null,
    work_items: Array.isArray(value?.work_items)
      ? value.work_items.map((work) => ({
          work_ref: work.work_ref ?? null,
          status: work.status ?? null,
          assignee_name: work.assignee_name ?? null,
          attempts: Array.isArray(work.attempts)
            ? work.attempts.map((attempt) => ({
                attempt_no: attempt.attempt_no ?? null,
                status: attempt.status ?? null,
                feedback_summary: outputSummary(attempt.feedback_summary),
                result_summary: outputSummary(attempt.result_summary),
              }))
            : [],
        }))
      : [],
    direct_messages: Array.isArray(value?.direct_messages)
      ? value.direct_messages.map((message) => ({
          sequence: message.sequence ?? null,
          sender_name: message.sender_name ?? null,
          recipient_name: message.recipient_name ?? null,
          summary: outputSummary(message.summary),
          requires_ack: message.requires_ack ?? null,
          status: message.status ?? null,
        }))
      : [],
    sessions: Array.isArray(value?.sessions)
      ? value.sessions.map((session) => ({
          name: session.name ?? null,
          role: session.role ?? null,
          status: session.status ?? null,
          turns: Array.isArray(session.turns)
            ? session.turns.map((turn) => ({
                sequence: turn.sequence ?? null,
                kind: turn.kind ?? null,
                status: turn.status ?? null,
                activation: turn.activation ?? null,
                context: outputSummary(turn.context),
              }))
            : [],
        }))
      : [],
  };
}

if (!baseUrl || !token) {
  throw new Error(
    'AGENT_SERVER_BASE_URL and AGENT_SERVER_SERVICE_TOKEN are required',
  );
}

progress('started', {
  provider: realProviderDefaults.PASEO_PROVIDER,
  model: realProviderDefaults.PASEO_MODEL,
  environment: 'runtime',
});

async function request(path, { method = 'GET', body, status } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'idempotency-key': randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (status !== undefined ? response.status !== status : !response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function importAndPublish(source, importPath, publishPath) {
  const imported = await request(importPath, {
    method: 'POST',
    body: { source },
    status: 201,
  });
  const published = await request(publishPath(imported.version.id), {
    method: 'POST',
    body: {},
  });
  return published.id ?? imported.version.id;
}

function agentYaml(name, instructions, refs) {
  const tools = refs.length
    ? `tools:\n${refs
        .map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`)
        .join('\n')}`
    : 'tools: []';
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}\nspec:\n  description: Canonical Agent Team smoke role\n  instructions: ${JSON.stringify(instructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  ${tools}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute exactly the next legal Team transition for your role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

const leadInstructions =
  'Act as the Lead using only the canonical collaboration tools. On every turn read collaboration_state and board_list first. If the board is empty, make exactly two board_create calls before stopping: first create W-1 assigned to builder with subject "Builder smoke marker" and description "Submit exactly AGENT_TEAM_SMOKE_BUILDER_OK"; then create W-2 with subject "Return smoke marker" and description "Submit exactly AGENT_TEAM_SMOKE_MEMBER_OK" but omit assignee so it is OPEN. Do not assign or claim W-2. If you receive direct message M-1 from analyst, call message_ack for M-1 exactly once, then stop. During review, accept completed W-1 exactly once. After analyst submits W-2 attempt 1, call board_request_changes exactly once for W-2 with assignee analyst and feedback "AGENT_TEAM_SMOKE_REWORK_REQUIRED"; do not accept that attempt. After analyst submits W-2 attempt 2, call board_accept exactly once for W-2. Only after W-1 and W-2 are accepted and no active attempt remains, call collaboration_finish exactly once. If work is open or in progress without a submitted attempt to review, make no mutation and stop. Never create duplicate Work, never use legacy Team command vocabulary, and never substitute prose for a required collaboration mutation.';
const analystInstructions =
  'Act as the analyst using only the canonical collaboration tools. On the work-availability delivery, read collaboration_state, board_list, and inbox_list, then explicitly call board_claim for W-2 and message_send exactly once to lead with body "AGENT_TEAM_SMOKE_DIRECT_REQUIRES_ACK", about_work_ref W-2, and requires_ack true; perform these actions once and stop. On the resulting work-attempt turn for attempt 1, call board_submit exactly once with summary "AGENT_TEAM_SMOKE_ATTEMPT_1". On the resulting rework attempt 2, call board_submit exactly once with summary "AGENT_TEAM_SMOKE_MEMBER_OK". Never create Work, request changes, accept Work, finish the collaboration, claim W-2 twice, use provider subagents, or substitute prose for a required collaboration mutation.';
const builderInstructions =
  'Act as the builder using only the canonical collaboration tools. On your assigned work-attempt turn, read collaboration_state and board_list, then call board_submit exactly once with summary "AGENT_TEAM_SMOKE_BUILDER_OK" and stop. Never create Work, claim Work, request changes, accept Work, finish the collaboration, use provider subagents, or substitute prose for the required board_submit mutation.';

const leadVersion = await importAndPublish(
  agentYaml('smoke-lead', leadInstructions, []),
  '/api/v1/agents:import',
  (id) => `/api/v1/agent-versions/${id}:publish`,
);
progress('agent_version_published', { role: 'lead', version_id: leadVersion });
const analystVersion = await importAndPublish(
  agentYaml('smoke-analyst', analystInstructions, []),
  '/api/v1/agents:import',
  (id) => `/api/v1/agent-versions/${id}:publish`,
);
progress('agent_version_published', {
  role: 'analyst',
  version_id: analystVersion,
});
const builderVersion = await importAndPublish(
  agentYaml('smoke-builder', builderInstructions, []),
  '/api/v1/agents:import',
  (id) => `/api/v1/agent-versions/${id}:publish`,
);
progress('agent_version_published', {
  role: 'builder',
  version_id: builderVersion,
});
const environmentVersion = await importAndPublish(
  `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: agent-team-smoke\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`,
  '/api/v1/environments:import',
  (id) => `/api/v1/environment-versions/${id}:publish`,
);
progress('environment_version_published', { version_id: environmentVersion });
const importedTeam = await request('/api/v1/teams:import', {
  method: 'POST',
  status: 201,
  body: {
    source: `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: agent-team-smoke\nspec:\n  environmentVersionId: ${environmentVersion}\n  lead:\n    name: lead\n    agentVersionId: ${leadVersion}\n  roster:\n    - name: builder\n      agentVersionId: ${builderVersion}\n    - name: analyst\n      agentVersionId: ${analystVersion}\n  coordination:\n    taskAssignment: lead_or_self_claim\n`,
  },
});
const teamVersion = await request(
  `/api/v1/team-versions/${importedTeam.version.id}:publish`,
  { method: 'POST', body: {} },
);
progress('team_version_published', { version_id: teamVersion.id });
const invoked = await request('/api/v1/tasks:invoke', {
  method: 'POST',
  status: 202,
  body: {
    invokable: { kind: 'team', version_id: teamVersion.id },
    input: { text: 'Complete the canonical multi-member Team smoke.' },
    workspace_id: workspaceId,
  },
});
progress('team_task_created', { task_id: invoked.task_id });

const deadline = Date.now() + timeoutMs;
let task;
let projection;
let lastProjection;
let nextProgressAt = Date.now();
let nextRunObservationAt = Date.now();
const observedRuns = new Map();
let outcome;
while (Date.now() < deadline) {
  task = await request(`/api/v1/tasks/${invoked.task_id}`);
  projection = await request(
    `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(invoked.task_id)}`,
  );
  const summary = {
    task_status: task.status,
    team_status: projection.project?.status ?? null,
    members: projection.sessions.map((session) => ({
      name: session.name,
      status: session.status,
      turn_count: session.turns.length,
    })),
  };
  const projectionChanged =
    JSON.stringify(summary) !== JSON.stringify(lastProjection);
  if (projectionChanged || Date.now() >= nextProgressAt) {
    progress('team_progress', summary);
    lastProjection = summary;
    nextProgressAt = Date.now() + progressIntervalMs;
  }
  const runs = projection.sessions.flatMap((session) =>
    session.turns.map((turn) => ({ member: session.name, turn })),
  );
  let discoveredRun = false;
  for (const { member, turn } of runs) {
    if (!observedRuns.has(turn.run_id)) {
      observedRuns.set(turn.run_id, undefined);
      discoveredRun = true;
      progress('member_run_created', {
        member,
        run_id: turn.run_id,
        kind: turn.kind,
      });
    }
  }
  if (discoveredRun || Date.now() >= nextRunObservationAt) {
    for (const { member, turn } of runs) {
      const run = await request(
        `/api/v1/runs/${encodeURIComponent(turn.run_id)}`,
      );
      const observed = {
        status: run.status,
        ...(run.runtime ? { runtime: run.runtime } : {}),
        ...(usageSummary(run.usage) ? { usage: usageSummary(run.usage) } : {}),
      };
      if (
        JSON.stringify(observed) !==
        JSON.stringify(observedRuns.get(turn.run_id))
      ) {
        observedRuns.set(turn.run_id, observed);
        progress('member_run_progress', {
          member,
          run_id: turn.run_id,
          ...observed,
        });
      }
    }
    nextRunObservationAt = Date.now() + progressIntervalMs;
  }
  outcome = classifySmokeOutcome({ taskStatus: task.status, projection });
  if (outcome.kind !== 'pending') break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
// Keep failure output bounded and provider-neutral while showing enough durable
// state to locate the missing Completion Line fact from CI logs alone.
async function dumpRunDiagnostics() {
  progress('team_failure_projection', {
    summary: projectionSummary(projection),
  });
  progress('team_failure_runs', {
    runs: [...observedRuns].map(([run_id, observed]) => ({
      run_id,
      status: observed?.status ?? 'not_observed',
      ...(observed?.runtime?.provider && observed?.runtime?.model
        ? {
            runtime: {
              provider: observed.runtime.provider,
              model: observed.runtime.model,
            },
          }
        : {}),
      ...(observed?.usage ? { usage: usageSummary(observed.usage) } : {}),
    })),
  });
}

// If the loop ended because the deadline elapsed, reclassify the last observed
// state as a gate timeout. `pending` is an interim polling result, never a
// reportable conclusion.
outcome = classifySmokeOutcome({
  taskStatus: task?.status,
  projection,
  timedOut: Date.now() >= deadline,
});
if (outcome.kind !== 'success') {
  await dumpRunDiagnostics().catch(() => {});
  throw new Error(formatSmokeOutcome(outcome));
}

const usageFields = [
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'total_cost_usd',
  'context_window_max_tokens',
  'context_window_used_tokens',
];
const runIds = [
  ...new Set(
    projection.sessions.flatMap((session) =>
      session.turns.map((turn) => turn.run_id),
    ),
  ),
];
const usage = {};
const runtimeModels = new Set();
for (const runId of runIds) {
  const run = await request(`/api/v1/runs/${encodeURIComponent(runId)}`);
  const runtime = run.runtime;
  if (runtime?.provider && runtime?.model) {
    runtimeModels.add(`${runtime.provider}/${runtime.model}`);
  }
  for (const field of usageFields) {
    const value = run.usage?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const total = (usage[field] ?? 0) + value;
    if (!Number.isFinite(total)) {
      throw new Error(`agent team smoke usage is not finite: ${field}`);
    }
    usage[field] = total;
  }
}
if (
  !(usage.input_tokens > 0) ||
  !(usage.output_tokens > 0) ||
  !(usage.total_cost_usd > 0) ||
  !runtimeModels.has(
    `${realProviderDefaults.PASEO_PROVIDER}/${realProviderDefaults.PASEO_MODEL}`,
  )
) {
  throw new Error(
    `agent team smoke did not report expected real-provider usage: ${JSON.stringify({ usage, runtime_models: [...runtimeModels] })}`,
  );
}
const outputs = projection.sessions.flatMap((session) =>
  session.turns
    .map((turn) => ({
      member: session.name,
      text: outputSummary(turn.result_text),
    }))
    .filter((output) => output.text !== undefined),
);
progress('agent_outputs', { outputs });
progress('completed', {
  task_id: invoked.task_id,
  team_status: projection.project.status,
  runtime_models: [...runtimeModels],
  usage: usageSummary(usage),
});
process.stdout.write(
  `${JSON.stringify({
    success: true,
    task_id: invoked.task_id,
    team_status: projection.project.status,
    runtime_models: [...runtimeModels],
    usage,
  })}\n`,
);
