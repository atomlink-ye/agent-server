import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
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

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const runtimeRoot = join(repositoryRoot, '.local', 'managed-real-e2e');
const agentWorkspace = join(runtimeRoot, 'agent-workspace');
const evidencePath = join(runtimeRoot, 'evidence.json');
const databaseUrl =
  process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL or POSTGRES_URL is required.');
}

const requestedModel = process.env.PASEO_SMOKE_MODEL?.trim();
if (
  requestedModel &&
  !/(?:^|[-/])free(?:$|-)/i.test(requestedModel)
) {
  throw new Error(
    'PASEO_SMOKE_MODEL must be an explicitly free model identifier.',
  );
}

const memoryMarker = `REAL_MANAGED_MEMORY_${randomUUID()
  .replaceAll('-', '')
  .slice(0, 24)}`;
const firstAnswerMarker = 'REAL_FIRST_RUN_OK';
const recallPrefix = 'REAL_RECALL_OK:';
const smokeToken = `managed-real-e2e-${randomUUID()}`;
const agentName = `Managed Real E2E ${randomUUID().slice(0, 8)}`;
const agentSource = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: ${agentName}
spec:
  description: Real Paseo/OpenCode managed-agent end-to-end verification.
  instructions: |
    You are an end-to-end verification agent. Follow only the current task input and the runtime contract.

    When the Current Task input starts with CREATE_MEMORY:
    1. Extract the exact value after MEMORY_VALUE= from the current task input.
    2. Use the available filesystem tools to write exactly one proposal with category project_constraint and that exact content to the exact relative path specified by the Internal runtime artifact contract appended to the prompt.
    3. The file must contain only the exact JSON shape required by that contract.
    4. After the file is written, reply with the marker REAL_FIRST_RUN_OK. Do not add explanations.

    When the Current Task input starts with RECALL_MEMORY:
    1. Read the Pinned verified MEMORY.md section supplied in the current prompt.
    2. Find the project_constraint content in that section.
    3. Reply with REAL_RECALL_OK: followed immediately by the exact stored content.
    4. If no pinned memory is present, reply exactly REAL_RECALL_MISSING.

    Never use or infer prior ProductSession chat history. Do not add analysis or extra prose to the final answer.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
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
  started_at: new Date().toISOString(),
  source_commit: '6f480f2651ed51d2e47ad4030be3041e32fd4d48',
  runtime: {
    paseo_version: '0.1.110',
    opencode_version: '1.18.4',
    requested_model: requestedModel ?? null,
  },
  assertions: {},
};

const paseoPort = await getAvailablePort();
const apiPort = await getAvailablePort();
let paseo;
let api;
let paseoPid;
let apiPid;
let pool;
let failure;

try {
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: paseoPort,
  });
  paseoPid = paseo.child.pid;
  await assertNoOpenCodeCredentials(runtimeRoot);

  const apiLogPath = join(runtimeRoot, 'agent-server.log');
  const apiLog = openSync(apiLogPath, 'a');
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
          PASEO_WORKSPACE_TITLE: 'Managed Agent Real E2E',
          ...(requestedModel ? { PASEO_MODEL: requestedModel } : {}),
          PASEO_CONNECT_TIMEOUT_MS: '15000',
          PASEO_EXECUTION_TIMEOUT_MS: '240000',
          SERVICE_ACCOUNTS_JSON: JSON.stringify([
            {
              serviceAccountId: 'svc_managed_real_e2e',
              token: smokeToken,
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
  const readyResponse = await waitForHttp(
    `${baseUrl}/health/ready`,
    120_000,
    api,
  );
  const readiness = await readyResponse.json();
  evidence.readiness = readiness;

  const authHeaders = { authorization: `Bearer ${smokeToken}` };
  const jsonHeaders = {
    ...authHeaders,
    'content-type': 'application/json',
  };

  const validated = await requestJson(
    'validate package',
    `${baseUrl}/api/v1/agent-packages:validate`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ source: agentSource }),
    },
    [200],
  );
  assert(validated.valid === true, 'Agent package validation did not pass.');

  const imported = await requestJson(
    'import agent',
    `${baseUrl}/api/v1/agents:import`,
    {
      method: 'POST',
      headers: {
        ...jsonHeaders,
        'idempotency-key': `managed-import-${randomUUID()}`,
      },
      body: JSON.stringify({ source: agentSource }),
    },
    [201],
  );
  const agentId = imported.agent?.id;
  const agentVersionId = imported.version?.id;
  assert(agentId && agentVersionId, 'Agent import did not return IDs.');

  const published = await requestJson(
    'publish agent version',
    `${baseUrl}/api/v1/agent-versions/${agentVersionId}:publish`,
    {
      method: 'POST',
      headers: {
        ...jsonHeaders,
        'idempotency-key': `managed-publish-${randomUUID()}`,
      },
      body: '{}',
    },
    [200],
  );
  assert(published.status === 'published', 'Agent version was not published.');

  const workspace = await requestJson(
    'create product workspace',
    `${baseUrl}/api/v1/workspaces`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Managed Real E2E Workspace' }),
    },
    [201],
  );
  const workspaceId = workspace.workspace_id;
  assert(workspaceId, 'Workspace creation did not return workspace_id.');

  const firstSession = await createSession(
    baseUrl,
    jsonHeaders,
    workspaceId,
    agentVersionId,
  );
  const firstInput = [
    'CREATE_MEMORY',
    `MEMORY_VALUE=${memoryMarker}`,
    'Create the proposal file as instructed, then finish.',
  ].join('\n');
  const firstMessage = await postMessage(
    baseUrl,
    jsonHeaders,
    firstSession.session_id,
    firstInput,
    `managed-first-message-${randomUUID()}`,
  );
  assert(firstMessage.status === 'queued', 'First message was not queued.');

  const firstSsePromise = readSseToTerminal(
    `${baseUrl}/api/v1/runs/${firstMessage.run_id}/events/stream`,
    authHeaders,
    300_000,
  );
  const firstRun = await pollRun(
    baseUrl,
    firstMessage.run_id,
    smokeToken,
    300_000,
  );
  const firstEvents = await firstSsePromise;
  assert(firstRun.status === 'succeeded', 'First real Agent run failed.');
  assert(
    firstRun.runtime?.provider === 'opencode',
    'First run did not use the OpenCode provider.',
  );
  assert(
    /(?:^|[-/])free(?:$|-)/i.test(firstRun.runtime?.model ?? ''),
    'First run did not use an explicitly free model.',
  );
  assert(
    String(firstRun.result?.text ?? '').includes(firstAnswerMarker),
    'First Agent answer did not contain the expected completion marker.',
  );
  assertEventSequence(firstEvents, ['started', 'output', 'succeeded']);

  const proposalArtifactPath = join(
    agentWorkspace,
    'scratchpad',
    'runs',
    firstMessage.run_id,
    'memory-proposals.json',
  );
  const proposalArtifactRaw = await readFile(proposalArtifactPath, 'utf8');
  const proposalArtifact = JSON.parse(proposalArtifactRaw);
  assert(
    JSON.stringify(proposalArtifact) ===
      JSON.stringify({
        proposals: [
          { category: 'project_constraint', content: memoryMarker },
        ],
      }),
    'The real Agent did not write the exact expected memory proposal artifact.',
  );
  const proposalArtifactSha256 = createHash('sha256')
    .update(proposalArtifactRaw)
    .digest('hex');

  const proposals = await waitForRuntimeProposal(
    baseUrl,
    authHeaders,
    workspaceId,
    firstMessage.run_id,
    memoryMarker,
    30_000,
  );
  assert(proposals.length === 1, 'Expected exactly one persisted runtime proposal.');
  const proposal = proposals[0];
  assert(
    proposal.source_task_id === firstMessage.task_id &&
      proposal.source_session_id === firstSession.session_id &&
      proposal.source_run_id === firstMessage.run_id &&
      proposal.source_agent_version_id === agentVersionId &&
      proposal.source_candidate_index === 0,
    'Runtime memory proposal provenance is incomplete.',
  );

  // Remove the first Run scratch artifact before recall. The marker must survive
  // only through governed workspace memory, not through a leftover run file.
  await rm(dirname(proposalArtifactPath), { recursive: true, force: true });
  const preAcceptMarkerFiles = await findFilesContaining(
    agentWorkspace,
    memoryMarker,
  );
  assert(
    preAcceptMarkerFiles.length === 0,
    'The marker remained in the Agent workspace before memory acceptance.',
  );

  const reviewed = await requestJson(
    'accept runtime memory proposal',
    `${baseUrl}/api/v1/workspace-memory/proposals/${proposal.proposal_id}/review`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ action: 'accept' }),
    },
    [200],
  );
  assert(
    reviewed.entry?.content === memoryMarker,
    'Accepted memory entry did not preserve the Agent proposal.',
  );

  const snapshot = await waitForReadySnapshot(
    baseUrl,
    authHeaders,
    workspaceId,
    memoryMarker,
    agentWorkspace,
    30_000,
  );

  const secondSession = await createSession(
    baseUrl,
    jsonHeaders,
    workspaceId,
    agentVersionId,
  );
  const secondMessage = await postMessage(
    baseUrl,
    jsonHeaders,
    secondSession.session_id,
    'RECALL_MEMORY\nReturn the exact accepted project constraint from pinned memory.',
    `managed-recall-message-${randomUUID()}`,
  );

  pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const pinnedResult = await pool.query(
    `SELECT memory_snapshot_id, memory_snapshot_hash
       FROM tasks
      WHERE id = $1`,
    [secondMessage.task_id],
  );
  const pinned = pinnedResult.rows[0];
  assert(
    pinned?.memory_snapshot_id === snapshot.snapshotId &&
      pinned?.memory_snapshot_hash === snapshot.contentHash,
    'The recall Task did not pin the accepted ready memory snapshot.',
  );

  const secondSsePromise = readSseToTerminal(
    `${baseUrl}/api/v1/runs/${secondMessage.run_id}/events/stream`,
    authHeaders,
    300_000,
  );
  const secondRun = await pollRun(
    baseUrl,
    secondMessage.run_id,
    smokeToken,
    300_000,
  );
  const secondEvents = await secondSsePromise;
  assert(secondRun.status === 'succeeded', 'Second real Agent run failed.');
  assert(
    secondRun.runtime?.provider === 'opencode',
    'Second run did not use the OpenCode provider.',
  );
  const recallText = String(secondRun.result?.text ?? '').trim();
  assert(
    recallText.includes(recallPrefix) && recallText.includes(memoryMarker),
    'The Fresh Agent did not recall the accepted memory marker.',
  );
  assertEventSequence(secondEvents, ['started', 'output', 'succeeded']);

  const secondMessages = await requestJson(
    'read fresh session messages',
    `${baseUrl}/api/v1/sessions/${secondSession.session_id}/messages`,
    { headers: authHeaders },
    [200],
  );
  const assistantMessages = (secondMessages.messages ?? []).filter(
    (message) => message.role === 'assistant',
  );
  assert(
    assistantMessages.some((message) =>
      String(message.text ?? '').includes(memoryMarker),
    ),
    'The recalled final assistant Message was not persisted.',
  );
  assert(
    !(secondMessages.messages ?? []).some((message) =>
      String(message.text ?? '').includes(firstInput),
    ),
    'The Fresh Session unexpectedly contained the prior Session input.',
  );

  await assertNoOpenCodeCredentials(runtimeRoot);

  Object.assign(evidence, {
    status: 'passed',
    completed_at: new Date().toISOString(),
    agent: {
      agent_id: agentId,
      version_id: agentVersionId,
      fingerprint: validated.fingerprint,
      status: published.status,
    },
    workspace: { workspace_id: workspaceId },
    first_execution: {
      session_id: firstSession.session_id,
      message_id: firstMessage.message_id,
      task_id: firstMessage.task_id,
      run_id: firstMessage.run_id,
      provider: firstRun.runtime.provider,
      model: firstRun.runtime.model,
      terminal_status: firstRun.status,
      output_marker_observed: true,
      sse_events: firstEvents.map((event) => event.event),
      proposal_artifact_sha256: proposalArtifactSha256,
      proposal_artifact_exact_match: true,
    },
    memory: {
      proposal_id: proposal.proposal_id,
      proposal_content: memoryMarker,
      proposal_category: proposal.category,
      provenance: {
        source_task_id: proposal.source_task_id,
        source_session_id: proposal.source_session_id,
        source_message_id: proposal.source_message_id,
        source_run_id: proposal.source_run_id,
        source_agent_version_id: proposal.source_agent_version_id,
        source_candidate_index: proposal.source_candidate_index,
      },
      review_outcome: reviewed.proposal?.review_outcome,
      entry_id: reviewed.entry?.entry_id,
      snapshot_id: snapshot.snapshotId,
      snapshot_version: snapshot.version,
      snapshot_hash: snapshot.contentHash,
      projection_status: snapshot.projectionStatus,
    },
    fresh_recall: {
      session_id: secondSession.session_id,
      message_id: secondMessage.message_id,
      task_id: secondMessage.task_id,
      run_id: secondMessage.run_id,
      pinned_snapshot_id: pinned.memory_snapshot_id,
      pinned_snapshot_hash: pinned.memory_snapshot_hash,
      provider: secondRun.runtime.provider,
      model: secondRun.runtime.model,
      terminal_status: secondRun.status,
      memory_marker_recalled: true,
      prior_session_input_absent: true,
      final_assistant_message_persisted: true,
      sse_events: secondEvents.map((event) => event.event),
    },
    assertions: {
      real_http_server: true,
      real_postgresql_16: true,
      real_paseo_websocket: true,
      real_opencode_agent_first_run: true,
      real_agent_wrote_memory_proposal_file: true,
      governed_acceptance_created_immutable_snapshot: true,
      fresh_real_opencode_agent_recalled_pinned_memory: true,
      fake_runtime_used: false,
    },
  });

  process.stdout.write(
    `${JSON.stringify({
      success: true,
      source_commit: evidence.source_commit,
      provider: firstRun.runtime.provider,
      model: firstRun.runtime.model,
      first_run_status: firstRun.status,
      memory_proposal_written_by_agent: true,
      snapshot_status: snapshot.projectionStatus,
      second_run_status: secondRun.status,
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
} finally {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await pool?.end().catch(() => undefined);
  await Promise.all([
    stopProcessTree(api),
    stopProcessTree(paseo?.child),
  ]);
  if (isProcessAlive(apiPid) || isProcessAlive(paseoPid)) {
    failure ??= new Error('E2E cleanup left a managed process running.');
  }
}

if (failure) throw failure;

async function createSession(
  baseUrl,
  headers,
  workspaceId,
  agentVersionId,
) {
  return requestJson(
    'create product session',
    `${baseUrl}/api/v1/sessions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: agentVersionId,
      }),
    },
    [201],
  );
}

async function postMessage(baseUrl, headers, sessionId, text, key) {
  return requestJson(
    'post product session message',
    `${baseUrl}/api/v1/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': key },
      body: JSON.stringify({ text }),
    },
    [202],
  );
}

async function requestJson(label, url, init, expectedStatuses) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);
  }
  if (!expectedStatuses.includes(response.status)) {
    const safeCode = body?.error?.code ?? 'unknown_error';
    throw new Error(
      `${label} returned HTTP ${response.status} (${safeCode}).`,
    );
  }
  return body;
}

async function pollRun(baseUrl, runId, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Run polling returned HTTP ${response.status}.`);
    }
    last = await response.json();
    if (
      ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(last.status)
    ) {
      return last;
    }
    await delay(500);
  }
  throw new Error(
    `Timed out polling Run; last status was ${last?.status ?? 'unknown'}.`,
  );
}

async function readSseToTerminal(url, headers, timeoutMs) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`SSE returned HTTP ${response.status}.`);
  }
  const text = await response.text();
  return text
    .split(/\n\n+/)
    .map((block) => {
      const id = block.match(/^id:\s*(.+)$/m)?.[1] ?? null;
      const event = block.match(/^event:\s*(.+)$/m)?.[1] ?? null;
      const dataText = block.match(/^data:\s*(.+)$/m)?.[1] ?? null;
      let data = null;
      if (dataText) {
        try {
          data = JSON.parse(dataText);
        } catch {
          data = null;
        }
      }
      return { id, event, data };
    })
    .filter((item) => item.event);
}

function assertEventSequence(events, expected) {
  const actual = events.map((event) => event.event);
  for (const type of expected) {
    assert(actual.includes(type), `SSE did not include ${type}.`);
  }
  const positions = expected.map((type) => actual.indexOf(type));
  assert(
    positions.every((position, index) =>
      index === 0 ? position >= 0 : position > positions[index - 1],
    ),
    `SSE events were not ordered as ${expected.join(' -> ')}.`,
  );
}

async function waitForRuntimeProposal(
  baseUrl,
  headers,
  workspaceId,
  runId,
  content,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await requestJson(
      'list product workspace proposals',
      `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/proposals`,
      { headers },
      [200],
    );
    const matches = (body.proposals ?? []).filter(
      (proposal) =>
        proposal.source_run_id === runId && proposal.content === content,
    );
    if (matches.length) return matches;
    await delay(250);
  }
  throw new Error('Timed out waiting for the real runtime memory proposal.');
}

async function waitForReadySnapshot(
  baseUrl,
  headers,
  workspaceId,
  marker,
  root,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await requestJson(
      'list managed memory snapshots',
      `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/snapshots`,
      { headers },
      [200],
    );
    const ready = (body.snapshots ?? [])
      .filter((snapshot) => snapshot.projectionStatus === 'ready')
      .sort((left, right) => right.version - left.version)[0];
    if (ready) {
      const markerFiles = await findFilesContaining(root, marker);
      assert(
        markerFiles.length > 0 &&
          markerFiles.every((path) => path.includes('memory-store')),
        'Accepted marker was not isolated to the managed memory projection.',
      );
      return ready;
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for a ready managed memory snapshot.');
}

async function assertNoOpenCodeCredentials(root) {
  const files = await findNamedFiles(root, 'auth.json');
  const openCodeCredentials = files.filter((path) =>
    path.toLowerCase().includes('opencode'),
  );
  if (openCodeCredentials.length > 0) {
    throw new Error('Zero-credential E2E found an OpenCode auth file.');
  }
}

async function findNamedFiles(root, name) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === name) found.push(path);
    }
  }
  await visit(root);
  return found;
}

async function findFilesContaining(root, needle) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      try {
        const content = await readFile(path, 'utf8');
        if (content.includes(needle)) found.push(path);
      } catch {
        // Binary or concurrently removed files are irrelevant to this assertion.
      }
    }
  }
  await visit(root);
  return found;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
