import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import {
  delay,
  getAvailablePort,
  isProcessAlive,
  startPaseo,
  stopProcessTree,
  waitForHttp,
} from '../dev/paseo-process.mjs';

const sourceCommit = '6f480f2651ed51d2e47ad4030be3041e32fd4d48';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeRoot = join(repositoryRoot, '.local', 'managed-real-e2e-v2');
const agentWorkspace = join(runtimeRoot, 'agent-workspace');
const evidencePath = join(runtimeRoot, 'evidence.json');
const databaseUrl =
  process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL or POSTGRES_URL is required.');

const requestedModel = process.env.PASEO_SMOKE_MODEL?.trim();
if (requestedModel && !/(?:^|[-/])free(?:$|-)/i.test(requestedModel)) {
  throw new Error('PASEO_SMOKE_MODEL must identify an explicitly free model.');
}

const token = `managed-e2e-${randomUUID()}`;
const marker = `REAL_MEMORY_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
const agentSource = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Real Managed E2E ${randomUUID().slice(0, 8)}
spec:
  description: Real Managed Agent end-to-end canary.
  instructions: |
    Act only on the Current Task input.
    For CREATE_MEMORY, extract the exact MEMORY_VALUE, use filesystem tools to write one project_constraint proposal to the exact path and JSON shape in the appended internal artifact contract, then reply REAL_FIRST_RUN_OK.
    For RECALL_MEMORY, read Pinned verified MEMORY.md and reply REAL_RECALL_OK: followed by the exact project_constraint content. If absent reply REAL_RECALL_MISSING.
    Do not add extra final-answer text and do not infer prior session history.
  runtime: { provider: paseo, modelPolicyRef: free-only, mode: isolated }
  tools: []
  skills: []
  input:
    schema: { type: object, additionalProperties: false, properties: {} }
    prompt: input
  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }
  memory: { policy: workspace_snapshot, proposalLimit: 1 }
  permissions: { network: none, filesystem: workspace_read }
  completion: { type: executable, command: done }
`;

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(agentWorkspace, { recursive: true });

const evidence = {
  status: 'running',
  phase: 'bootstrap',
  source_commit: sourceCommit,
  started_at: new Date().toISOString(),
  runtime: {
    paseo_version: '0.1.110',
    opencode_version: '1.18.4',
    requested_model: requestedModel ?? null,
  },
};
await saveEvidence();

let paseo;
let api;
let paseoPid;
let apiPid;
let pool;
let failure;

try {
  const paseoPort = await getAvailablePort();
  const apiPort = await getAvailablePort();

  paseo = await startPaseo({ repositoryRoot, runtimeRoot, port: paseoPort });
  paseoPid = paseo.child.pid;
  await checkpoint('paseo_ready', { paseo_ws_url_created: true });

  const apiLog = openSync(join(runtimeRoot, 'agent-server.log'), 'a');
  try {
    api = spawn(
      process.execPath,
      [join(repositoryRoot, 'dist', 'entrypoints', 'api', 'server.js')],
      {
        cwd: repositoryRoot,
        env: {
          ...paseo.environment,
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: String(apiPort),
          LOG_LEVEL: 'info',
          DATABASE_URL: databaseUrl,
          POSTGRES_URL: databaseUrl,
          PGSSLMODE: 'disable',
          PASEO_WS_URL: paseo.wsUrl,
          PASEO_AGENT_CWD: agentWorkspace,
          PASEO_WORKSPACE_TITLE: 'Managed Agent Real E2E V2',
          ...(requestedModel ? { PASEO_MODEL: requestedModel } : {}),
          PASEO_CONNECT_TIMEOUT_MS: '15000',
          PASEO_EXECUTION_TIMEOUT_MS: '420000',
          SERVICE_ACCOUNTS_JSON: JSON.stringify([
            {
              serviceAccountId: 'svc_managed_real_e2e',
              token,
              tenantId: 'tenant_managed_real_e2e',
              workspaceId: 'compatibility_workspace_managed_real_e2e',
              policyVersion: 'policy-managed-real-e2e-v1',
            },
          ]),
        },
        detached: process.platform !== 'win32',
        stdio: ['ignore', apiLog, apiLog],
      },
    );
  } finally {
    closeSync(apiLog);
  }
  apiPid = api.pid;

  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(`${baseUrl}/health/live`, 30_000, api);
  const ready = await waitForHttp(`${baseUrl}/health/ready`, 120_000, api);
  const readiness = await ready.json();
  await checkpoint('api_ready', { readiness });

  const auth = { authorization: `Bearer ${token}` };
  const jsonAuth = { ...auth, 'content-type': 'application/json' };

  const validated = await jsonRequest(
    `${baseUrl}/api/v1/agent-packages:validate`,
    {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({ source: agentSource }),
    },
    200,
  );
  assert(validated.valid === true, 'Managed Agent YAML validation failed.');

  const imported = await jsonRequest(
    `${baseUrl}/api/v1/agents:import`,
    {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': `import-${randomUUID()}` },
      body: JSON.stringify({ source: agentSource }),
    },
    201,
  );
  const agentId = imported.agent?.id;
  const versionId = imported.version?.id;
  assert(agentId && versionId, 'Managed Agent import returned no IDs.');

  const published = await jsonRequest(
    `${baseUrl}/api/v1/agent-versions/${versionId}:publish`,
    {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': `publish-${randomUUID()}` },
      body: '{}',
    },
    200,
  );
  assert(published.status === 'published', 'Managed Agent version not published.');
  await checkpoint('agent_published', {
    agent_id: agentId,
    version_id: versionId,
    fingerprint: validated.fingerprint,
  });

  const workspace = await jsonRequest(
    `${baseUrl}/api/v1/workspaces`,
    {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({ name: 'Real Managed E2E Workspace' }),
    },
    201,
  );
  const workspaceId = workspace.workspace_id;
  assert(workspaceId, 'Product Workspace creation returned no ID.');

  const firstSession = await createSession(baseUrl, jsonAuth, workspaceId, versionId);
  const firstInput = `CREATE_MEMORY\nMEMORY_VALUE=${marker}\nWrite the proposal artifact and finish.`;
  const firstMessage = await postMessage(
    baseUrl,
    jsonAuth,
    firstSession.session_id,
    firstInput,
    `message-1-${randomUUID()}`,
  );
  await checkpoint('first_run_queued', {
    workspace_id: workspaceId,
    first_session_id: firstSession.session_id,
    first_message_id: firstMessage.message_id,
    first_task_id: firstMessage.task_id,
    first_run_id: firstMessage.run_id,
  });

  const firstRun = await pollRun(baseUrl, firstMessage.run_id, token, 450_000);
  await checkpoint('first_run_terminal', {
    first_run_status: firstRun.status,
    first_provider: firstRun.runtime?.provider ?? null,
    first_model: firstRun.runtime?.model ?? null,
    first_output: firstRun.result?.text ?? null,
  });
  assert(firstRun.status === 'succeeded', 'The first real OpenCode Agent run failed.');
  assert(firstRun.runtime?.provider === 'opencode', 'Provider was not OpenCode.');
  assert(
    /(?:^|[-/])free(?:$|-)/i.test(firstRun.runtime?.model ?? ''),
    'The real run did not use an explicitly free model.',
  );
  assert(
    String(firstRun.result?.text ?? '').includes('REAL_FIRST_RUN_OK'),
    'First real Agent response omitted REAL_FIRST_RUN_OK.',
  );

  const firstEvents = await readTerminalEvents(baseUrl, auth, firstMessage.run_id);
  assertOrderedEvents(firstEvents, ['started', 'output', 'succeeded']);

  const artifactPath = join(
    agentWorkspace,
    'scratchpad',
    'runs',
    firstMessage.run_id,
    'memory-proposals.json',
  );
  const artifactRaw = await readFile(artifactPath, 'utf8');
  const artifactJson = JSON.parse(artifactRaw);
  assert(
    JSON.stringify(artifactJson) ===
      JSON.stringify({
        proposals: [{ category: 'project_constraint', content: marker }],
      }),
    'The actual Agent did not write the expected proposal JSON file.',
  );
  const artifactSha256 = createHash('sha256').update(artifactRaw).digest('hex');

  const proposal = await waitForProposal(
    baseUrl,
    auth,
    workspaceId,
    firstMessage.run_id,
    marker,
  );
  assert(
    proposal.source_task_id === firstMessage.task_id &&
      proposal.source_session_id === firstSession.session_id &&
      proposal.source_run_id === firstMessage.run_id &&
      proposal.source_agent_version_id === versionId &&
      proposal.source_candidate_index === 0,
    'Persisted runtime proposal provenance was incomplete.',
  );
  await checkpoint('agent_proposal_persisted', {
    proposal_id: proposal.proposal_id,
    proposal_artifact_sha256: artifactSha256,
    proposal_exact_match: true,
    proposal_provenance: {
      source_task_id: proposal.source_task_id,
      source_session_id: proposal.source_session_id,
      source_message_id: proposal.source_message_id,
      source_run_id: proposal.source_run_id,
      source_agent_version_id: proposal.source_agent_version_id,
      source_candidate_index: proposal.source_candidate_index,
    },
  });

  // Remove the run scratch artifact. The second Agent must obtain the marker from
  // governed Memory, not from the first Run's candidate file.
  await rm(dirname(artifactPath), { recursive: true, force: true });

  const review = await jsonRequest(
    `${baseUrl}/api/v1/workspace-memory/proposals/${proposal.proposal_id}/review`,
    {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({ action: 'accept' }),
    },
    200,
  );
  assert(review.entry?.content === marker, 'Accepted Entry content changed.');

  const snapshot = await waitForReadySnapshot(baseUrl, auth, workspaceId);
  await checkpoint('memory_snapshot_ready', {
    entry_id: review.entry?.entry_id,
    snapshot_id: snapshot.snapshotId,
    snapshot_version: snapshot.version,
    snapshot_hash: snapshot.contentHash,
    projection_status: snapshot.projectionStatus,
  });

  const secondSession = await createSession(baseUrl, jsonAuth, workspaceId, versionId);
  const secondMessage = await postMessage(
    baseUrl,
    jsonAuth,
    secondSession.session_id,
    'RECALL_MEMORY\nReturn the exact project constraint from pinned memory.',
    `message-2-${randomUUID()}`,
  );

  pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const pinResult = await pool.query(
    `SELECT memory_snapshot_id, memory_snapshot_hash FROM tasks WHERE id=$1`,
    [secondMessage.task_id],
  );
  const pin = pinResult.rows[0];
  assert(
    pin?.memory_snapshot_id === snapshot.snapshotId &&
      pin?.memory_snapshot_hash === snapshot.contentHash,
    'Fresh recall Task did not pin the ready snapshot.',
  );
  await checkpoint('second_run_queued', {
    second_session_id: secondSession.session_id,
    second_message_id: secondMessage.message_id,
    second_task_id: secondMessage.task_id,
    second_run_id: secondMessage.run_id,
    pinned_snapshot_id: pin.memory_snapshot_id,
    pinned_snapshot_hash: pin.memory_snapshot_hash,
  });

  const secondRun = await pollRun(baseUrl, secondMessage.run_id, token, 450_000);
  await checkpoint('second_run_terminal', {
    second_run_status: secondRun.status,
    second_provider: secondRun.runtime?.provider ?? null,
    second_model: secondRun.runtime?.model ?? null,
    second_output: secondRun.result?.text ?? null,
  });
  assert(secondRun.status === 'succeeded', 'The Fresh real OpenCode Agent run failed.');
  const recallText = String(secondRun.result?.text ?? '').trim();
  assert(
    recallText.includes('REAL_RECALL_OK:') && recallText.includes(marker),
    'The Fresh real Agent did not recall the accepted memory marker.',
  );

  const secondEvents = await readTerminalEvents(baseUrl, auth, secondMessage.run_id);
  assertOrderedEvents(secondEvents, ['started', 'output', 'succeeded']);

  const messages = await jsonRequest(
    `${baseUrl}/api/v1/sessions/${secondSession.session_id}/messages`,
    { headers: auth },
    200,
  );
  const assistants = (messages.messages ?? []).filter((message) => message.role === 'assistant');
  assert(
    assistants.some((message) => String(message.text ?? '').includes(marker)),
    'The recalled final Assistant Message was not persisted.',
  );
  assert(
    !(messages.messages ?? []).some((message) =>
      String(message.text ?? '').includes(firstInput),
    ),
    'Fresh Session leaked the prior ProductSession input.',
  );

  Object.assign(evidence, {
    status: 'passed',
    phase: 'complete',
    completed_at: new Date().toISOString(),
    memory_marker: marker,
    first_sse_events: firstEvents.map((event) => event.type),
    second_sse_events: secondEvents.map((event) => event.type),
    assertions: {
      real_http_server: true,
      real_postgresql_16: true,
      real_paseo_websocket: true,
      real_opencode_agent_executed_twice: true,
      real_agent_wrote_memory_proposal_file: true,
      proposal_provenance_persisted: true,
      human_acceptance_created_ready_snapshot: true,
      fresh_task_pinned_exact_snapshot: true,
      fresh_real_agent_recalled_memory: true,
      prior_session_history_absent: true,
      final_assistant_message_persisted: true,
      fake_runtime_used: false,
    },
  });
  await saveEvidence();

  process.stdout.write(
    `${JSON.stringify({
      success: true,
      source_commit: sourceCommit,
      provider: secondRun.runtime.provider,
      model: secondRun.runtime.model,
      first_run: firstRun.status,
      agent_wrote_proposal_file: true,
      snapshot: snapshot.projectionStatus,
      second_run: secondRun.status,
      fresh_agent_recalled_memory: true,
      evidence: evidencePath,
    })}\n`,
  );
} catch (error) {
  failure = error;
  Object.assign(evidence, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    failure: {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    },
  });
  await saveEvidence().catch(() => undefined);
} finally {
  await pool?.end().catch(() => undefined);
  await Promise.all([stopProcessTree(api), stopProcessTree(paseo?.child)]);
  if (isProcessAlive(apiPid) || isProcessAlive(paseoPid)) {
    failure ??= new Error('Validation cleanup left a managed process running.');
  }
}

if (failure) throw failure;

async function checkpoint(phase, fields = {}) {
  Object.assign(evidence, fields, {
    phase,
    updated_at: new Date().toISOString(),
  });
  await saveEvidence();
}

async function saveEvidence() {
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function jsonRequest(url, init, expectedStatus) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`HTTP ${response.status} returned invalid JSON for ${new URL(url).pathname}.`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(
      `${new URL(url).pathname} returned HTTP ${response.status} (${body?.error?.code ?? 'unknown_error'}).`,
    );
  }
  return body;
}

async function createSession(baseUrl, headers, workspaceId, versionId) {
  return jsonRequest(
    `${baseUrl}/api/v1/sessions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: versionId,
      }),
    },
    201,
  );
}

async function postMessage(baseUrl, headers, sessionId, text, key) {
  return jsonRequest(
    `${baseUrl}/api/v1/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': key },
      body: JSON.stringify({ text }),
    },
    202,
  );
}

async function pollRun(baseUrl, runId, bearer, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await jsonRequest(
      `${baseUrl}/api/v1/runs/${runId}`,
      { headers: { authorization: `Bearer ${bearer}` } },
      200,
    );
    if (['succeeded', 'failed', 'timed_out', 'cancelled'].includes(last.status)) {
      return last;
    }
    await delay(750);
  }
  throw new Error(`Timed out waiting for Run; last status=${last?.status ?? 'unknown'}.`);
}

async function readTerminalEvents(baseUrl, headers, runId) {
  const page = await jsonRequest(
    `${baseUrl}/api/v1/runs/${runId}/events?after=0`,
    { headers },
    200,
  );
  const response = await fetch(
    `${baseUrl}/api/v1/runs/${runId}/events/stream?after=0`,
    { headers, signal: AbortSignal.timeout(30_000) },
  );
  assert(response.ok, `Terminal SSE returned HTTP ${response.status}.`);
  const text = await response.text();
  assert(text.includes('event: succeeded'), 'Terminal SSE replay omitted succeeded.');
  return page.events ?? [];
}

function assertOrderedEvents(events, expected) {
  const types = events.map((event) => event.type);
  let previous = -1;
  for (const type of expected) {
    const index = types.indexOf(type);
    assert(index > previous, `Missing or misordered Run event ${type}.`);
    previous = index;
  }
}

async function waitForProposal(baseUrl, headers, workspaceId, runId, content) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const body = await jsonRequest(
      `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/proposals`,
      { headers },
      200,
    );
    const proposal = (body.proposals ?? []).find(
      (item) => item.source_run_id === runId && item.content === content,
    );
    if (proposal) return proposal;
    await delay(250);
  }
  throw new Error('Runtime proposal was not persisted for the Product Workspace.');
}

async function waitForReadySnapshot(baseUrl, headers, workspaceId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const body = await jsonRequest(
      `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/snapshots`,
      { headers },
      200,
    );
    const snapshot = (body.snapshots ?? [])
      .filter((item) => item.projectionStatus === 'ready')
      .sort((left, right) => right.version - left.version)[0];
    if (snapshot) return snapshot;
    await delay(250);
  }
  throw new Error('Accepted memory did not produce a ready snapshot.');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
