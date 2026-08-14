import { randomUUID } from 'node:crypto';

const baseUrl = process.env.AGENT_SERVER_BASE_URL?.trim();
const token = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
const workspaceId =
  process.env.AGENT_SERVER_WORKSPACE_ID?.trim() ??
  '00000000-0000-4000-8000-000000000001';
const timeoutMs = Number(process.env.AGENT_TEAM_SMOKE_TIMEOUT_MS ?? 300_000);

if (!baseUrl || !token) {
  throw new Error(
    'AGENT_SERVER_BASE_URL and AGENT_SERVER_SERVICE_TOKEN are required',
  );
}

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
    .join('\n')}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute exactly the next legal Team transition for your role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

const leadInstructions =
  'Act as Team Lead using only canonical Team tools. Read the board first. If no Work exists, create exactly one Work assigned to analyst with subject "Return smoke marker" and description "Submit exactly AGENT_TEAM_SMOKE_MEMBER_OK", then stop. If the analyst Work is completed, accept it. When every Work is accepted and no active attempt remains, call team_finish exactly once. Never create duplicate Work and never substitute prose for a required Team mutation.';
const analystInstructions =
  'Act as the assigned Team member using canonical Team tools. Read the board, locate your active Work, and submit it exactly once with result summary AGENT_TEAM_SMOKE_MEMBER_OK. Do not create Work, accept Work, finish the Team, use provider subagents, or emit unrelated prose.';

const leadVersion = await importAndPublish(
  agentYaml('smoke-lead', leadInstructions, [
    'team-state',
    'team-work-list',
    'team-work-create',
    'team-work-accept-v2',
    'team-finish',
  ]),
  '/api/v1/agents:import',
  (id) => `/api/v1/agent-versions/${id}:publish`,
);
const analystVersion = await importAndPublish(
  agentYaml('smoke-analyst', analystInstructions, [
    'team-state',
    'team-work-list',
    'team-work-submit',
  ]),
  '/api/v1/agents:import',
  (id) => `/api/v1/agent-versions/${id}:publish`,
);
const environmentVersion = await importAndPublish(
  `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: agent-team-smoke\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`,
  '/api/v1/environments:import',
  (id) => `/api/v1/environment-versions/${id}:publish`,
);
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
const invoked = await request('/api/v1/tasks:invoke', {
  method: 'POST',
  status: 202,
  body: {
    invokable: { kind: 'team', version_id: teamVersion.id },
    input: { text: 'Complete the canonical one-member Team smoke.' },
    workspace_id: workspaceId,
  },
});

const deadline = Date.now() + timeoutMs;
let task;
let projection;
while (Date.now() < deadline) {
  task = await request(`/api/v1/tasks/${invoked.task_id}`);
  projection = await request(
    `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(invoked.task_id)}`,
  );
  if (['completed', 'failed', 'cancelled'].includes(task.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (task?.status !== 'completed') {
  throw new Error(`agent team smoke task did not complete: ${JSON.stringify(task)}`);
}
if (projection?.project?.status !== 'succeeded') {
  throw new Error(
    `agent team smoke projection did not succeed: ${JSON.stringify(projection)}`,
  );
}
process.stdout.write(
  `${JSON.stringify({
    success: true,
    task_id: invoked.task_id,
    team_status: projection.project.status,
  })}\n`,
);
