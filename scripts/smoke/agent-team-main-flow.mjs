import { randomUUID } from 'node:crypto';
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
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}\nspec:\n  description: Canonical Agent Team smoke role\n  instructions: ${JSON.stringify(instructions)}\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools:\n${refs
    .map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`)
    .join(
      '\n',
    )}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute exactly the next legal Team transition for your role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

const leadInstructions =
  'Act as Team Lead using only canonical Team tools. Use board_list to read the board first. If no Work exists, use board_create to create exactly one Work assigned to analyst with subject "Return smoke marker" and description "Submit exactly AGENT_TEAM_SMOKE_MEMBER_OK", then stop. If the analyst Work is completed, use board_accept to accept it. When every Work is accepted and no active attempt remains, call collaboration_finish exactly once. Never create duplicate Work and never substitute prose for a required Team mutation.';
const analystInstructions =
  'Act as the assigned Team member using canonical Team tools. Use board_list to read the board, locate your active Work, and use board_submit to submit it exactly once with result summary AGENT_TEAM_SMOKE_MEMBER_OK. Do not create Work, accept Work, finish the Team, use provider subagents, or emit unrelated prose.';

const leadVersion = await importAndPublish(
  agentYaml('smoke-lead', leadInstructions, [
    'collaboration-state',
    'board-list',
    'board-create',
    'board-accept',
    'collaboration-finish',
  ]),
  '/api/v1/agents:import',
  (id) => `/api/v1/agent-versions/${id}:publish`,
);
progress('agent_version_published', { role: 'lead', version_id: leadVersion });
const analystVersion = await importAndPublish(
  agentYaml('smoke-analyst', analystInstructions, [
    'collaboration-state',
    'board-list',
    'board-submit',
  ]),
  '/api/v1/agents:import',
  (id) => `/api/v1/agent-versions/${id}:publish`,
);
progress('agent_version_published', {
  role: 'analyst',
  version_id: analystVersion,
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
    source: `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: agent-team-smoke\nspec:\n  environmentVersionId: ${environmentVersion}\n  lead:\n    name: lead\n    agentVersionId: ${leadVersion}\n  roster:\n    - name: analyst\n      agentVersionId: ${analystVersion}\n  coordination:\n    taskAssignment: lead_or_self_claim\n`,
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
    input: { text: 'Complete the canonical one-member Team smoke.' },
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
  if (['completed', 'failed', 'cancelled'].includes(task.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
// When this smoke fails it is usually because a member turn ran but the Team
// never reached a terminal state, and the message above only reports the outer
// Task. That is not enough to tell a Lead that legitimately needs more turns
// from a Lead that never converges. Dump the per-run event stream for every run
// we observed so the failure is locatable from CI logs alone. Run events carry
// no prompts, credentials, provider wire objects or raw provider errors
// (docs/contracts/run-api.md), so this is safe to emit.
async function dumpRunDiagnostics() {
  progress('team_failure_projection', { projection: projection ?? null });
  for (const runId of observedRuns.keys()) {
    try {
      const events = await request(
        `/api/v1/runs/${encodeURIComponent(runId)}/events?after=0`,
      );
      progress('team_failure_run_events', {
        run_id: runId,
        events: events.events ?? events,
      });
    } catch (error) {
      progress('team_failure_run_events_unavailable', {
        run_id: runId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

if (task?.status !== 'completed') {
  // Diagnostics must never replace or mask the real failure.
  await dumpRunDiagnostics().catch(() => {});
  throw new Error(
    `agent team smoke task did not complete: ${JSON.stringify(task)}`,
  );
}
if (projection?.project?.status !== 'succeeded') {
  throw new Error(
    `agent team smoke projection did not succeed: ${JSON.stringify(projection)}`,
  );
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
