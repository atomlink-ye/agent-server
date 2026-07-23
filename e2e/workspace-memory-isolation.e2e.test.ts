import { serve, type ServerType } from '@hono/node-server';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
} from '../tests/fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../tests/fixtures/fake-agent-runtime.js';
import type { PostgresRunDispatcher } from '../src/infrastructure/postgres/postgres-run-dispatcher.js';

const auth = { authorization: `Bearer ${primaryServiceAccountToken}` };
const jsonAuth = { ...auth, 'content-type': 'application/json' };
const markerA = 'A_ONLY_MARKER';
const markerB = 'OTHER_WORKSPACE_MARKER_7A31';
const agentSource = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Workspace Isolation Agent
spec:
  description: deterministic workspace isolation fixture
  instructions: Recall only the pinned workspace memory.
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
  memory: { policy: workspace_snapshot, proposalLimit: 2 }
  permissions: { network: none, filesystem: none }
  completion: { type: executable, command: done }
`;

describe('bidirectional Product Workspace memory isolation', () => {
  let server: ServerType;
  let baseUrl: string;
  let runtime: FakeAgentRuntime;
  let database: PGlite;
  const dispatcherControl: { dispatcher?: PostgresRunDispatcher } = {};
  const databaseControl: { database?: PGlite } = {};
  const fixtureControl: {
    seedAcceptedEntry?: (
      workspaceId: string,
      content: string,
    ) => Promise<{
      proposalId: string;
      entryId: string;
      snapshotId: string;
      contentHash: string;
    }>;
  } = {};

  beforeAll(async () => {
    runtime = new FakeAgentRuntime({ deriveMemoryResponse: true });
    const app = await createTestApp(runtime, {
      dispatcherControl,
      databaseControl,
      workspaceMemoryFixtureControl: fixtureControl,
    });
    database = databaseControl.database!;
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening)
      await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('E2E server did not expose a TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await dispatcherControl.dispatcher?.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await database.close();
  });

  it('pins and serves only each workspace snapshot in both directions', async () => {
    const imported = await request('/api/v1/agents:import', {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'isolation-import' },
      body: JSON.stringify({ source: agentSource }),
    });
    expect(imported.status).toBe(201);
    const importedBody = (await imported.json()) as { version: { id: string } };
    const published = await request(
      `/api/v1/agent-versions/${importedBody.version.id}:publish`,
      {
        method: 'POST',
        headers: { ...jsonAuth, 'idempotency-key': 'isolation-publish' },
        body: '{}',
      },
    );
    expect(published.status).toBe(200);

    const workspaceA = await createWorkspace('Product Workspace A');
    const workspaceB = await createWorkspace('Product Workspace B');
    const seedA = await fixtureControl.seedAcceptedEntry!(workspaceA, markerA);
    const seedB = await fixtureControl.seedAcceptedEntry!(workspaceB, markerB);
    const snapshotsA = await listMemory(workspaceA, 'snapshots');
    const snapshotsB = await listMemory(workspaceB, 'snapshots');
    const snapshotA = snapshotsA.snapshots[0]!;
    const snapshotB = snapshotsB.snapshots[0]!;
    expect(snapshotsA.snapshots).toHaveLength(1);
    expect(snapshotsB.snapshots).toHaveLength(1);
    expect(snapshotA).toMatchObject({
      snapshotId: seedA.snapshotId,
      contentHash: seedA.contentHash,
      projectionStatus: 'ready',
    });
    expect(snapshotB).toMatchObject({
      snapshotId: seedB.snapshotId,
      contentHash: seedB.contentHash,
      projectionStatus: 'ready',
    });

    const sessionA = await createSession(workspaceA, importedBody.version.id);
    const sessionB = await createSession(workspaceB, importedBody.version.id);
    const messageA = await postMessage(
      sessionA,
      'Recall workspace A memory.',
      'isolation-a',
    );
    const messageB = await postMessage(
      sessionB,
      'Recall workspace B memory.',
      'isolation-b',
    );
    await waitForRun(messageA.run_id);
    await waitForRun(messageB.run_id);

    const pinned = await database.query<{
      id: string;
      memory_snapshot_id: string;
      memory_snapshot_hash: string;
    }>(
      'SELECT id, memory_snapshot_id, memory_snapshot_hash FROM tasks WHERE id IN ($1,$2)',
      [messageA.task_id, messageB.task_id],
    );
    expect(pinned.rows).toEqual(
      expect.arrayContaining([
        {
          id: messageA.task_id,
          memory_snapshot_id: seedA.snapshotId,
          memory_snapshot_hash: seedA.contentHash,
        },
        {
          id: messageB.task_id,
          memory_snapshot_id: seedB.snapshotId,
          memory_snapshot_hash: seedB.contentHash,
        },
      ]),
    );

    const promptsA = runtime.prompts.filter((prompt) =>
      prompt.includes(markerA),
    );
    const promptsB = runtime.prompts.filter((prompt) =>
      prompt.includes(markerB),
    );
    expect(promptsA).toHaveLength(1);
    expect(promptsB).toHaveLength(1);
    expect(promptsA[0]).toContain(markerA);
    expect(promptsA[0]).not.toContain(markerB);
    expect(promptsB[0]).toContain(markerB);
    expect(promptsB[0]).not.toContain(markerA);

    const messagesA = await listMessages(sessionA);
    const messagesB = await listMessages(sessionB);
    const assistantsA = messagesA.messages.filter(
      (message) => message.role === 'assistant',
    );
    const assistantsB = messagesB.messages.filter(
      (message) => message.role === 'assistant',
    );
    expect(assistantsA).toHaveLength(1);
    expect(assistantsB).toHaveLength(1);
    const assistantA = assistantsA[0]!;
    const assistantB = assistantsB[0]!;
    expect(assistantsA[0]).toMatchObject({
      taskId: messageA.task_id,
      runId: messageA.run_id,
    });
    expect(assistantsB[0]).toMatchObject({
      taskId: messageB.task_id,
      runId: messageB.run_id,
    });
    expect(assistantA.text).toContain(markerA);
    expect(assistantA.text).not.toContain(markerB);
    expect(assistantB.text).toContain(markerB);
    expect(assistantB.text).not.toContain(markerA);

    const entriesA = await listMemory(workspaceA, 'entries');
    const entriesB = await listMemory(workspaceB, 'entries');
    const proposalsA = await listMemory(workspaceA, 'proposals');
    const proposalsB = await listMemory(workspaceB, 'proposals');
    expect(
      JSON.stringify({
        entries: entriesA,
        proposals: proposalsA,
        snapshots: snapshotsA,
      }),
    ).toContain(markerA);
    expect(
      JSON.stringify({
        entries: entriesA,
        proposals: proposalsA,
        snapshots: snapshotsA,
      }),
    ).not.toContain(markerB);
    expect(
      JSON.stringify({
        entries: entriesB,
        proposals: proposalsB,
        snapshots: snapshotsB,
      }),
    ).toContain(markerB);
    expect(
      JSON.stringify({
        entries: entriesB,
        proposals: proposalsB,
        snapshots: snapshotsB,
      }),
    ).not.toContain(markerA);
    expect(JSON.stringify(entriesA)).toContain(seedA.entryId);
    expect(JSON.stringify(proposalsA)).toContain(seedA.proposalId);
    expect(JSON.stringify(snapshotsA)).toContain(seedA.snapshotId);
    expect(JSON.stringify(entriesB)).toContain(seedB.entryId);
    expect(JSON.stringify(proposalsB)).toContain(seedB.proposalId);
    expect(JSON.stringify(snapshotsB)).toContain(seedB.snapshotId);

    for (const path of [
      `/api/v1/workspaces/${workspaceA}/memory/entries`,
      `/api/v1/workspaces/${workspaceA}/memory/proposals`,
      `/api/v1/workspaces/${workspaceA}/memory/snapshots`,
    ]) {
      expect(
        (
          await request(path, {
            headers: {
              authorization: `Bearer ${secondaryServiceAccountToken}`,
            },
          })
        ).status,
      ).toBe(404);
    }
    expect(defaultPublishedAgentVersionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  async function request(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, init);
  }
  async function createWorkspace(name: string): Promise<string> {
    const response = await request('/api/v1/workspaces', {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({ name }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { workspace_id: string }).workspace_id;
  }
  async function createSession(
    workspaceId: string,
    versionId: string,
  ): Promise<string> {
    const response = await request('/api/v1/sessions', {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: versionId,
      }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { session_id: string }).session_id;
  }
  async function postMessage(sessionId: string, text: string, key: string) {
    const response = await request(`/api/v1/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': key },
      body: JSON.stringify({ text }),
    });
    expect(response.status).toBe(202);
    return (await response.json()) as {
      task_id: string;
      run_id: string;
      generation: number;
      sequence: number;
    };
  }
  async function listMessages(sessionId: string) {
    return (await (
      await request(`/api/v1/sessions/${sessionId}/messages`, { headers: auth })
    ).json()) as {
      messages: Array<{
        role: string;
        text: string;
        taskId?: string;
        runId?: string;
      }>;
    };
  }
  async function listMemory(
    workspaceId: string,
    kind: 'entries' | 'proposals' | 'snapshots',
  ): Promise<{
    entries: Array<Record<string, unknown>>;
    proposals: Array<Record<string, unknown>>;
    snapshots: Array<Record<string, unknown>>;
  }> {
    return (await (
      await request(`/api/v1/workspaces/${workspaceId}/memory/${kind}`, {
        headers: auth,
      })
    ).json()) as {
      entries: Array<Record<string, unknown>>;
      proposals: Array<Record<string, unknown>>;
      snapshots: Array<Record<string, unknown>>;
    };
  }
  async function waitForRun(runId: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const body = (await (
        await request(`/api/v1/runs/${runId}`, { headers: auth })
      ).json()) as { status: string };
      if (body.status === 'succeeded') return;
      if (['failed', 'cancelled', 'timed_out'].includes(body.status))
        throw new Error(`run ${runId} reached ${body.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`run did not terminate: ${runId}`);
  }
});
