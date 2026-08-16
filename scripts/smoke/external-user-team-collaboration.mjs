#!/usr/bin/env node

// A real-provider regression gate for the external-user contract: every
// participant declares `tools: []`. It must still coordinate through platform
// collaboration capabilities. The release-note scenario starts with dialogue,
// proves member-to-member messages and self-claim, then requires a lead-driven
// rework before the durable release-note artifact is accepted.

import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { loadRealProviderDefaults } from '../dev/real-provider-defaults.mjs';

const defaults = loadRealProviderDefaults();
const baseUrl = process.env.AGENT_SERVER_BASE_URL?.trim();
const token = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const workspaceId =
  process.env.AGENT_SERVER_WORKSPACE_ID?.trim() ??
  '00000000-0000-4000-8000-000000000001';
const timeoutMs = Number(process.env.EXTERNAL_USER_TEAM_TIMEOUT_MS ?? 900_000);
const readyTimeoutMs = Number(
  process.env.EXTERNAL_USER_TEAM_READY_TIMEOUT_MS ?? 300_000,
);
const startedAt = Date.now();
const scenarioId = randomUUID().slice(0, 8);

if (!baseUrl || !token || !databaseUrl) {
  throw new Error(
    'AGENT_SERVER_BASE_URL, AGENT_SERVER_SERVICE_TOKEN, and DATABASE_URL are required',
  );
}

function progress(stage, details = {}) {
  process.stdout.write(
    `${JSON.stringify({
      event: 'external_user_team_collaboration_progress',
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      stage,
      ...details,
    })}\n`,
  );
}

function summary(text) {
  return typeof text === 'string' ? text.slice(0, 320) : null;
}

async function request(
  path,
  { method = 'GET', body, expectedStatus, allowStatuses } = {},
) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'POST' && path !== '/api/v1/works' && !/\/works\/[^/]+\/runs$/u.test(path)
        ? { 'idempotency-key': randomUUID() }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} returned invalid JSON`);
    }
  }
  if (allowStatuses?.includes(response.status)) {
    return { status: response.status, body: parsed };
  }
  if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} -> ${response.status} ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

async function waitForRuntimeReady() {
  const deadline = Date.now() + readyTimeoutMs;
  let nextProgressAt = 0;
  while (Date.now() < deadline) {
    const observed = await request('/health/ready', {
      allowStatuses: [200, 503],
    });
    if (observed.status === 200) return;
    if (Date.now() >= nextProgressAt) {
      progress('runtime_not_ready', {
        checks: observed.body?.checks?.map((check) => ({
          name: check.name,
          status: check.status,
        })),
      });
      nextProgressAt = Date.now() + 15_000;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`health_ready_timeout_after_${readyTimeoutMs}ms`);
}

async function importAndPublish(source, importPath, publishPath) {
  const imported = await request(importPath, {
    method: 'POST',
    expectedStatus: 201,
    body: { source },
  });
  const published = await request(publishPath(imported.version.id), {
    method: 'POST',
    expectedStatus: 200,
    body: {},
  });
  return published.id;
}

function agentPackage(name, instructions) {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: ${name}
spec:
  description: User-authored participant in a three-person release-note review
  instructions: ${JSON.stringify(instructions)}
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
    prompt: "Complete the next requested collaboration step."
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

const leadInstructions =
  'You are the release editor. Start with dialogue, not Work: use collaboration_state and then message_send to send researcher exactly RELEASE_BRIEF_REQUEST and reviewer exactly REVIEW_BRIEF_REQUEST. Do not create Work on the first turn. After you receive both research and review messages, use board_create exactly once to create open Work W-1, subject "Corrected release note", description "Submit a corrected two-bullet release note", with no assignee. After researcher submits attempt 1, use board_request_changes exactly once with feedback RELEASE_NOTE_NEEDS_COMPATIBILITY_CAVEAT. After researcher submits attempt 2, use board_accept exactly once. When the Work is accepted and no attempt remains active, call collaboration_finish exactly once. Never assign or claim W-1 yourself.';
const researcherInstructions =
  'You are the release-note researcher. When you receive RELEASE_BRIEF_REQUEST, use message_send to send reviewer exactly RESEARCH_FINDING: versioned Teams are immutable, then use message_send to send lead exactly RESEARCH_READY. When W-1 becomes open, use board_claim exactly once. On attempt 1 submit exactly RELEASE_NOTE_DRAFT_V1. On the returned attempt submit exactly RELEASE_NOTE_FINAL_WITH_COMPATIBILITY_CAVEAT. Do not create Work, accept Work, request changes, or finish collaboration.';
const reviewerInstructions =
  'You are the compatibility reviewer. When you receive REVIEW_BRIEF_REQUEST or RESEARCH_FINDING, use message_send to send researcher exactly REVIEWER_ACK and use message_send to send lead exactly REVIEW_CAVEAT_REQUIRED. Do not create, claim, submit, accept, or return Work.';

async function pollForCompletion(rootTaskId) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const task = await request(`/api/v1/tasks/${rootTaskId}`);
    const projection = await request(
      `/api/v1/team-runs:project?root_task_id=${encodeURIComponent(rootTaskId)}`,
    );
    const observed = JSON.stringify({
      task: task.status,
      team: projection.project?.status ?? null,
      phase: projection.project?.phase ?? null,
      messages: projection.direct_messages?.length ?? 0,
      work: projection.work_items?.map((item) => ({
        ref: item.work_ref,
        status: item.status,
        attempts: item.attempts?.length,
      })),
    });
    if (observed !== last) {
      progress('team_progress', JSON.parse(observed));
      last = observed;
    }
    if (task.status === 'completed' || ['failed', 'cancelled'].includes(task.status)) {
      return { task, projection };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`external user Team timed out after ${timeoutMs}ms`);
}

async function durableFacts(pool, rootTaskId) {
  const team = await pool.query(
    `SELECT tr.id, tr.status, tr.stop_reason
       FROM team_runs tr
      WHERE tr.root_task_id=$1`,
    [rootTaskId],
  );
  const teamRun = team.rows[0];
  if (!teamRun) throw new Error('durable TeamRun row is missing');
  const [messages, activations, work] = await Promise.all([
    pool.query(
      `SELECT m.sequence, m.body, sender.name AS sender_name, sender.role AS sender_role,
              recipient.name AS recipient_name, recipient.role AS recipient_role
         FROM team_messages m
         JOIN team_member_runs sender ON sender.id=m.sender_member_run_id
         JOIN team_member_runs recipient ON recipient.id=m.recipient_member_run_id
        WHERE m.team_run_id=$1 AND m.kind='direct'
        ORDER BY m.sequence`,
      [teamRun.id],
    ),
    pool.query(
      `SELECT task.team_task_kind, task.team_activation_materializer, task.team_activation_causes,
              member.name AS activated_member_name, member.role AS activated_member_role
         FROM tasks task
         LEFT JOIN team_member_runs member ON member.id=task.team_member_run_id
        WHERE task.root_task_id=$1 AND task.team_task_kind IS NOT NULL
        ORDER BY task.created_at`,
      [rootTaskId],
    ),
    pool.query(
      `SELECT w.work_ref, w.status, assignee.name AS assignee_name, assignee.role AS assignee_role,
              a.attempt_no, a.status AS attempt_status, a.result_summary, a.feedback
         FROM team_work_items w
         LEFT JOIN team_work_item_attempts a ON a.work_item_id=w.id
         LEFT JOIN team_member_runs assignee ON assignee.id=w.assignee_member_run_id
        WHERE w.team_run_id=$1
        ORDER BY w.work_ref, a.attempt_no`,
      [teamRun.id],
    ),
  ]);
  return {
    team: teamRun,
    messages: messages.rows,
    activations: activations.rows,
    work: work.rows,
  };
}

function assertDurableFacts(facts) {
  if (facts.team.status !== 'succeeded' || facts.team.stop_reason === 'lead_no_progress') {
    throw new Error(`Team did not succeed: ${JSON.stringify(facts.team)}`);
  }
  const firstMessage = facts.messages[0];
  const peerMessages = facts.messages.filter(
    (message) => message.sender_role === 'member' && message.recipient_role === 'member',
  );
  const hasAckedPeerExchange =
    peerMessages.some((message) => message.body?.includes('RESEARCH_FINDING')) &&
    peerMessages.some((message) => message.body?.includes('REVIEWER_ACK'));
  if (
    firstMessage?.sender_role !== 'lead' ||
    !firstMessage.body?.includes('RELEASE_BRIEF_REQUEST') ||
    !hasAckedPeerExchange
  ) {
    throw new Error(
      `durable dialogue-first peer exchange missing: ${JSON.stringify(facts.messages)}`,
    );
  }
  const activationTypes = facts.activations.flatMap((activation) =>
    Array.isArray(activation.team_activation_causes)
      ? activation.team_activation_causes.map((cause) => cause?.type)
      : [],
  );
  const hasMaterializedMessageWake = facts.activations.some(
    (activation) =>
      activation.activated_member_role === 'member' &&
      Array.isArray(activation.team_activation_causes) &&
      activation.team_activation_causes.some((cause) => cause?.type === 'message'),
  );
  if (
    !facts.activations.some(
      (activation) => activation.team_activation_materializer === 'task_run_collaboration_activation_adapter',
    ) ||
    !hasMaterializedMessageWake ||
    !['message', 'work_available', 'claim', 'final_review'].every((type) =>
      activationTypes.includes(type),
    )
  ) {
    throw new Error(`structured activation causes missing: ${JSON.stringify(facts.activations)}`);
  }
  const attempts = facts.work.filter((row) => row.work_ref === 'W-1');
  if (
    attempts.length !== 2 ||
    attempts[0]?.status !== 'accepted' ||
    attempts[0]?.assignee_role !== 'member' ||
    attempts[0]?.attempt_no !== 1 ||
    attempts[0]?.attempt_status !== 'completed' ||
    !attempts[0]?.result_summary?.includes('RELEASE_NOTE_DRAFT_V1') ||
    !attempts[1]?.feedback?.includes('RELEASE_NOTE_NEEDS_COMPATIBILITY_CAVEAT') ||
    attempts[1]?.attempt_no !== 2 ||
    attempts[1]?.attempt_status !== 'completed' ||
    !attempts[1]?.result_summary?.includes('RELEASE_NOTE_FINAL_WITH_COMPATIBILITY_CAVEAT')
  ) {
    throw new Error(`durable release-note artifact or rework facts missing: ${JSON.stringify(attempts)}`);
  }
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  progress('started', {
    provider: defaults.PASEO_PROVIDER,
    model: defaults.PASEO_MODEL,
    timeout_ms: timeoutMs,
    collaboration_tool_refs_in_agent_yaml: 0,
  });
  await waitForRuntimeReady();
  progress('runtime_ready');
  const leadVersion = await importAndPublish(
    agentPackage(`external-lead-${scenarioId}`, leadInstructions),
    '/api/v1/agents:import',
    (id) => `/api/v1/agent-versions/${id}:publish`,
  );
  const researcherVersion = await importAndPublish(
    agentPackage(`external-researcher-${scenarioId}`, researcherInstructions),
    '/api/v1/agents:import',
    (id) => `/api/v1/agent-versions/${id}:publish`,
  );
  const reviewerVersion = await importAndPublish(
    agentPackage(`external-reviewer-${scenarioId}`, reviewerInstructions),
    '/api/v1/agents:import',
    (id) => `/api/v1/agent-versions/${id}:publish`,
  );
  const environmentVersion = await importAndPublish(
    `apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: external-user-team-environment-${scenarioId}
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
    expectedStatus: 201,
    body: {
      source: `apiVersion: agent-server/v1alpha1
kind: ManagedTeam
metadata:
  name: external-user-release-note-team-${scenarioId}
spec:
  environmentVersionId: ${environmentVersion}
  lead:
    name: lead
    agentVersionId: ${leadVersion}
  roster:
    - name: researcher
      agentVersionId: ${researcherVersion}
    - name: reviewer
      agentVersionId: ${reviewerVersion}
  coordination:
    taskAssignment: lead_or_self_claim
`,
    },
  });
  const teamVersion = await request(
    `/api/v1/team-versions/${importedTeam.version.id}:publish`,
    { method: 'POST', expectedStatus: 200, body: {} },
  );
  const invoked = await request('/api/v1/tasks:invoke', {
    method: 'POST',
    expectedStatus: 202,
    body: {
      invokable: { kind: 'team', version_id: teamVersion.id },
      input: { text: 'Produce and review the corrected two-bullet release note.' },
      workspace_id: workspaceId,
    },
  });
  progress('team_invoked', { task_id: invoked.task_id });
  let task;
  let projection;
  try {
    ({ task, projection } = await pollForCompletion(invoked.task_id));
  } catch (error) {
    try {
      const factsBeforeFailure = await durableFacts(pool, invoked.task_id);
      progress('durable_facts_before_failure', {
        team: factsBeforeFailure.team,
        messages: factsBeforeFailure.messages.map((message) => ({
          sequence: message.sequence,
          sender: message.sender_name,
          recipient: message.recipient_name,
          body: summary(message.body),
        })),
        activations: factsBeforeFailure.activations,
        work: factsBeforeFailure.work,
      });
    } catch (factError) {
      progress('durable_facts_before_failure_unavailable', {
        error: factError instanceof Error ? factError.message : String(factError),
      });
    }
    throw error;
  }
  const facts = await durableFacts(pool, invoked.task_id);
  progress('durable_facts', {
    team: facts.team,
    messages: facts.messages.map((message) => ({
      sequence: message.sequence,
      sender: message.sender_name,
      recipient: message.recipient_name,
      body: summary(message.body),
    })),
    activations: facts.activations,
    work: facts.work,
  });
  if (task.status !== 'completed') {
    throw new Error(`root Task did not complete: ${JSON.stringify({ task: task.status, projection })}`);
  }
  assertDurableFacts(facts);
  progress('completed', { task_id: invoked.task_id, team_run_id: facts.team.id });
} finally {
  await pool.end();
}
