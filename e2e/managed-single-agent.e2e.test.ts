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

const workspaceId = '00000000-0000-4000-8000-00000000f001';
const auth = { authorization: `Bearer ${primaryServiceAccountToken}` };
const jsonAuth = { ...auth, 'content-type': 'application/json' };
let socketBaseUrl = '';
const canarySource = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Primary Competitor Researcher
spec:
  description: socket canary
  instructions: Produce a concise competitor research result.
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
const canaryMessage =
  'Run the canary and classify every candidate from this exact invocation.';
const acceptedCanary = '所有报告都必须区分事实、推断和建议。';
const rejectedCanary = 'REJECTED_CANARY_MARKER_9D2E';
const lateCanary = 'LATE_AFTER_CANARY_SNAPSHOT_4B71';

describe('managed single-agent memory recall', () => {
  let server: ServerType;
  let baseUrl: string;
  let runtime: FakeAgentRuntime;
  const dispatcherControl: { dispatcher?: PostgresRunDispatcher } = {};
  const databaseControl: { database?: PGlite } = {};

  beforeAll(async () => {
    runtime = new FakeAgentRuntime({
      deriveMemoryResponse: true,
      delayMs: 500,
      canaryPrompt: canaryMessage,
      canaryResponseText: 'CANARY_FINAL_ANSWER_2026',
      canaryMemoryCandidates: [
        {
          content: acceptedCanary,
          category: 'project_constraint',
        },
        { content: rejectedCanary, category: 'project_constraint' },
      ],
    });
    const app = await createTestApp(runtime, {
      workspaceId,
      dispatcherControl,
      databaseControl,
    });
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening)
      await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('E2E server did not expose a TCP address');
    baseUrl = socketBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await dispatcherControl.dispatcher?.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await databaseControl.database?.close();
  });

  it('recalls only accepted memory pinned at message admission', async () => {
    const sourceTaskResponse = await fetch(`${baseUrl}/api/v1/tasks:invoke`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'memory-source-task' },
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'source task' },
        workspace_id: workspaceId,
      }),
    });
    expect(sourceTaskResponse.status).toBe(202);
    const sourceTask = (await sourceTaskResponse.json()) as { task_id: string };
    const proposal = await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({
          content: 'Accepted workspace fact.',
          category: 'fact',
          source_task_id: sourceTask.task_id,
        }),
      },
    );
    const proposalBody = (await proposal.json()) as {
      proposal: { proposal_id: string };
    };
    const accepted = await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals/${proposalBody.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(accepted.status).toBe(200);
    const snapshots = await fetch(
      `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/snapshots`,
      { headers: auth },
    );
    expect(
      (
        (await snapshots.json()) as {
          snapshots: Array<{ projectionStatus: string }>;
        }
      ).snapshots.some((snapshot) => snapshot.projectionStatus === 'ready'),
    ).toBe(true);

    const rejectedProposal = await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ content: 'Rejected fact.', category: 'fact' }),
      },
    );
    const rejectedBody = (await rejectedProposal.json()) as {
      proposal: { proposal_id: string };
    };
    await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals/${rejectedBody.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ action: 'reject' }),
      },
    );

    const session = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: defaultPublishedAgentVersionId,
      }),
    });
    const sessionBody = (await session.json()) as { session_id: string };
    const message = await fetch(
      `${baseUrl}/api/v1/sessions/${sessionBody.session_id}/messages`,
      {
        method: 'POST',
        headers: { ...jsonAuth, 'idempotency-key': 'fresh-message-1' },
        body: JSON.stringify({ text: 'Recall the fact.' }),
      },
    );
    expect(message.status).toBe(202);
    const messageBody = (await message.json()) as { run_id: string };
    const lateProposal = await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({
          content: 'Late-after-admission fact.',
          category: 'fact',
        }),
      },
    );
    const lateBody = (await lateProposal.json()) as {
      proposal: { proposal_id: string };
    };
    await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals/${lateBody.proposal.proposal_id}/review`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(
      (
        await fetch(`${baseUrl}/api/v1/workspaces/foreign/memory/entries`, {
          headers: auth,
        })
      ).status,
    ).toBe(404);
    for (
      let i = 0;
      i < 200 &&
      !runtime.prompts.some((prompt) =>
        prompt.includes('Accepted workspace fact.'),
      );
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (
      !runtime.prompts.some((prompt) =>
        prompt.includes('Accepted workspace fact.'),
      )
    ) {
      const run = await fetch(`${baseUrl}/api/v1/runs/${messageBody.run_id}`, {
        headers: auth,
      });
      throw new Error(`run=${JSON.stringify(await run.json())}`);
    }
    const recalledPrompt = runtime.prompts.find((prompt) =>
      prompt.includes('Accepted workspace fact.'),
    )!;
    expect(recalledPrompt).not.toContain('Rejected fact');
    expect(recalledPrompt).not.toContain('Late-after-admission fact.');

    let messageList: {
      messages: Array<{ role: string; text: string; run_id: string }>;
    } = { messages: [] };
    for (let i = 0; i < 100; i++) {
      const messages = await fetch(
        `${baseUrl}/api/v1/sessions/${sessionBody.session_id}/messages`,
        { headers: auth },
      );
      messageList = (await messages.json()) as typeof messageList;
      if (messageList.messages.some((item) => item.role === 'assistant')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(
      messageList.messages,
      JSON.stringify({ messageBody, messageList }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          text: expect.any(String),
        }),
      ]),
    );
    const sourceAssistant = messageList.messages.find(
      (item) => item.role === 'assistant',
    );
    expect(sourceAssistant?.text).not.toContain(rejectedCanary);
    expect(sourceAssistant?.text).not.toContain(lateCanary);
  });

  it('proves the primary competitor researcher socket canary and SSE reconnect', async () => {
    expect(
      (
        await fetch(`${baseUrl}/api/v1/agent-packages:validate`, {
          method: 'POST',
          headers: jsonAuth,
          body: JSON.stringify({ source: canarySource }),
        })
      ).status,
    ).toBe(200);
    const imported = await fetch(`${baseUrl}/api/v1/agents:import`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'socket-canary-import-v1' },
      body: JSON.stringify({ source: canarySource }),
    });
    expect(imported.status).toBe(201);
    const importedBody = (await imported.json()) as {
      agent: { id: string };
      version: { id: string };
    };
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/agent-versions/${importedBody.version.id}:publish`,
          {
            method: 'POST',
            headers: {
              ...jsonAuth,
              'idempotency-key': 'socket-canary-publish-v1',
            },
            body: '{}',
          },
        )
      ).status,
    ).toBe(200);
    runtime.ready = false;
    const oldTaskResponse = await fetch(`${baseUrl}/api/v1/tasks:invoke`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'socket-old-v1' },
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: importedBody.version.id,
        },
        input: { text: 'old version pin' },
        workspace_id: workspaceId,
      }),
    });
    expect(oldTaskResponse.status).toBe(202);
    const oldTaskId = ((await oldTaskResponse.json()) as { task_id: string })
      .task_id;
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/agents/00000000-0000-4000-8000-00000000dead`,
          { headers: auth },
        )
      ).status,
    ).toBe(404);
    const v2Source = canarySource.replace(
      'Produce a concise competitor research result.',
      'Produce a v2 competitor research result.',
    );
    const importedV2 = await fetch(`${baseUrl}/api/v1/agents:import`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'socket-canary-import-v2' },
      body: JSON.stringify({ source: v2Source }),
    });
    expect(importedV2.status).toBe(201);
    const importedV2Body = (await importedV2.json()) as {
      agent: { id: string };
      version: { id: string };
    };
    expect(importedV2Body.agent.id).toBe(importedBody.agent.id);
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/agent-versions/${importedV2Body.version.id}:publish`,
          {
            method: 'POST',
            headers: {
              ...jsonAuth,
              'idempotency-key': 'socket-canary-publish-v2',
            },
            body: '{}',
          },
        )
      ).status,
    ).toBe(200);
    const pinnedTask = (await (
      await fetch(`${baseUrl}/api/v1/tasks/${oldTaskId}`, { headers: auth })
    ).json()) as { invokable: { version_id: string }; status: string };
    expect(pinnedTask.invokable.version_id).toBe(importedBody.version.id);
    runtime.ready = true;
    await waitForTask(oldTaskId, 'completed');
    expect(runtime.prompts.some((prompt) => prompt.includes('v2'))).toBe(false);
    expect(
      runtime.prompts.some((prompt) => prompt.includes('concise competitor')),
    ).toBe(true);
    const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: importedBody.version.id,
      }),
    });
    const sessionId = ((await sessionResponse.json()) as { session_id: string })
      .session_id;
    const canaryGate = runtime.armExecutionGate();
    const message = await fetch(
      `${baseUrl}/api/v1/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: { ...jsonAuth, 'idempotency-key': 'socket-canary-message' },
        body: JSON.stringify({
          text: canaryMessage,
        }),
      },
    );
    expect(message.status).toBe(202);
    const messageBody = (await message.json()) as {
      task_id: string;
      run_id: string;
    };
    await canaryGate.entered;
    expect(runtime.activeRunIds.has(messageBody.run_id)).toBe(true);
    const firstSse = await fetch(
      `${baseUrl}/api/v1/runs/${messageBody.run_id}/events/stream`,
      { headers: auth },
    );
    expect(firstSse.status).toBe(200);
    const reader = firstSse.body!.getReader();
    const firstChunk = await reader.read();
    const firstChunkText = new TextDecoder().decode(firstChunk.value);
    const receivedId = Number(firstChunkText.match(/^id: (\d+)$/m)?.[1]);
    expect(Number.isSafeInteger(receivedId)).toBe(true);
    await reader.cancel();
    canaryGate.release();
    await waitForSocketRun(messageBody.run_id, 'succeeded');
    const canaryMessages = (await (
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
      })
    ).json()) as {
      messages: Array<{
        role: string;
        text: string;
        taskId?: string;
        runId?: string;
        generation?: number;
      }>;
    };
    expect(canaryMessages.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          text: 'CANARY_FINAL_ANSWER_2026',
          taskId: messageBody.task_id,
          runId: messageBody.run_id,
        }),
      ]),
    );
    const proposals = (await (
      await fetch(`${baseUrl}/api/v1/workspace-memory/proposals`, {
        headers: auth,
      })
    ).json()) as {
      proposals: Array<{
        proposal_id: string;
        content: string;
        source_task_id: string | null;
        source_session_id: string | null;
        source_message_id: string | null;
        source_run_id: string | null;
        source_agent_version_id: string | null;
        source_candidate_index: number | null;
      }>;
    };
    const canaryProposals = proposals.proposals.filter(
      (proposal) => proposal.source_run_id === messageBody.run_id,
    );
    expect(canaryProposals).toHaveLength(2);
    expect(
      [...canaryProposals]
        .sort(
          (left, right) =>
            (left.source_candidate_index ?? -1) -
            (right.source_candidate_index ?? -1),
        )
        .map((proposal) => proposal.content),
    ).toEqual([acceptedCanary, rejectedCanary]);
    const candidate = canaryProposals.find(
      (proposal) => proposal.content === acceptedCanary,
    );
    const rejectedCandidate = canaryProposals.find(
      (proposal) => proposal.content === rejectedCanary,
    );
    expect(candidate).toBeDefined();
    expect(rejectedCandidate).toBeDefined();
    if (!candidate || !rejectedCandidate)
      throw new Error('runtime canary proposals were not persisted');
    expect(candidate).toMatchObject({
      source_task_id: messageBody.task_id,
      source_session_id: sessionId,
      source_message_id: expect.any(String),
      source_run_id: messageBody.run_id,
      source_agent_version_id: importedBody.version.id,
      source_candidate_index: 0,
      status: 'pending',
    });
    expect(rejectedCandidate).toMatchObject({
      source_task_id: messageBody.task_id,
      source_session_id: sessionId,
      source_message_id: candidate.source_message_id,
      source_run_id: messageBody.run_id,
      source_agent_version_id: importedBody.version.id,
      source_candidate_index: 1,
      status: 'pending',
    });
    const sourceTask = (await (
      await fetch(`${baseUrl}/api/v1/tasks/${messageBody.task_id}`, {
        headers: auth,
      })
    ).json()) as { invokable: { version_id: string } };
    expect(sourceTask.invokable.version_id).toBe(importedBody.version.id);
    const sourceMessages = (await (
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
      })
    ).json()) as {
      messages: Array<{
        id?: string;
        taskId?: string;
        task_id?: string;
        runId?: string;
        messageId?: string;
        message_id?: string;
        run_id?: string;
      }>;
    };
    const sourceMessage = sourceMessages.messages.find(
      (item) =>
        (item.taskId ?? item.task_id) === messageBody.task_id &&
        (item.runId ?? item.run_id) === messageBody.run_id,
    );
    expect(
      sourceMessages.messages.some(
        (item) =>
          (item.taskId ?? item.task_id) === messageBody.task_id &&
          (item.runId ?? item.run_id) === messageBody.run_id,
      ),
    ).toBe(true);
    expect(candidate.source_message_id).toBe(
      sourceMessage?.id ??
        sourceMessage?.messageId ??
        sourceMessage?.message_id,
    );
    const eventPage = (await (
      await fetch(
        `${baseUrl}/api/v1/runs/${messageBody.run_id}/events?after=0`,
        { headers: auth },
      )
    ).json()) as { events: Array<{ sequence: number; type: string }> };
    expect(eventPage.events.map((event) => event.type)).toEqual([
      'started',
      'output',
      'succeeded',
    ]);
    const reconnect = await fetch(
      `${baseUrl}/api/v1/runs/${messageBody.run_id}/events/stream`,
      { headers: { ...auth, 'last-event-id': String(receivedId) } },
    );
    const reconnectText = await reconnect.text();
    const replayedIds = [...reconnectText.matchAll(/^id: (\d+)$/gm)].map(
      (match) => Number(match[1]),
    );
    expect(replayedIds.length).toBeGreaterThan(0);
    expect(new Set(replayedIds).size).toBe(replayedIds.length);
    expect(replayedIds.every((id) => id > receivedId)).toBe(true);
    expect(reconnectText).toContain('event: succeeded');
    expect((reconnectText.match(/event: succeeded/g) ?? []).length).toBe(1);
    const terminalCursor = await fetch(
      `${baseUrl}/api/v1/runs/${messageBody.run_id}/events/stream?after=${Math.max(...replayedIds)}`,
      { headers: auth },
    );
    expect(terminalCursor.status).toBe(200);
    expect(await terminalCursor.text()).toBe('');
    const snapshotsBeforeRuntimeAccept = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/snapshots`,
        { headers: auth },
      )
    ).json()) as { snapshots: Array<{ snapshotId: string; version: number }> };
    const acceptedReview = await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals/${candidate.proposal_id}/review`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ action: 'accept' }),
      },
    );
    expect(acceptedReview.status).toBe(200);
    const rejectedReview = await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals/${rejectedCandidate.proposal_id}/review`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ action: 'reject' }),
      },
    );
    expect(rejectedReview.status).toBe(200);
    const snapshots = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/snapshots`,
        { headers: auth },
      )
    ).json()) as {
      snapshots: Array<{
        snapshotId: string;
        contentHash: string;
        projectionStatus: string;
        version: number;
        workspaceId: string;
      }>;
    };
    const readySnapshot = snapshots.snapshots.find(
      (snapshot) =>
        snapshot.projectionStatus === 'ready' &&
        !snapshotsBeforeRuntimeAccept.snapshots.some(
          (prior) => prior.snapshotId === snapshot.snapshotId,
        ),
    );
    expect(readySnapshot).toBeDefined();
    if (!readySnapshot) throw new Error('canary snapshot was not ready');
    expect(readySnapshot).toMatchObject({
      projectionStatus: 'ready',
      workspaceId,
    });
    expect(readySnapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const entries = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/entries`,
        { headers: auth },
      )
    ).json()) as {
      entries: Array<{
        content: string;
        sourceTaskId: string | null;
        sourceSessionId: string | null;
        sourceMessageId: string | null;
        sourceRunId: string | null;
        sourceAgentVersionId: string | null;
        sourceCandidateIndex: number | null;
      }>;
    };
    const acceptedEntry = entries.entries.find(
      (entry) => entry.content === acceptedCanary,
    );
    expect(acceptedEntry).toMatchObject({
      sourceTaskId: messageBody.task_id,
      sourceSessionId: sessionId,
      sourceMessageId: candidate.source_message_id,
      sourceRunId: messageBody.run_id,
      sourceAgentVersionId: importedBody.version.id,
      sourceCandidateIndex: 0,
    });
    expect(entries.entries.map((entry) => entry.content)).not.toContain(
      rejectedCanary,
    );
    expect(entries.entries.map((entry) => entry.content)).not.toContain(
      lateCanary,
    );
    const second = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: importedBody.version.id,
      }),
    });
    const secondId = ((await second.json()) as { session_id: string })
      .session_id;
    const recall = await fetch(
      `${baseUrl}/api/v1/sessions/${secondId}/messages`,
      {
        method: 'POST',
        headers: { ...jsonAuth, 'idempotency-key': 'socket-canary-recall' },
        body: JSON.stringify({ text: 'What is the exact constraint?' }),
      },
    );
    const recallBody = (await recall.json()) as {
      task_id: string;
      run_id: string;
    };
    const pinnedRecall = (
      await databaseControl.database!.query(
        'SELECT memory_snapshot_id, memory_snapshot_hash FROM tasks WHERE id=$1',
        [recallBody.task_id],
      )
    ).rows[0] as { memory_snapshot_id: string; memory_snapshot_hash: string };
    expect(pinnedRecall).toEqual({
      memory_snapshot_id: readySnapshot.snapshotId,
      memory_snapshot_hash: readySnapshot.contentHash,
    });
    const lateProposal = await fetch(
      `${baseUrl}/api/v1/workspace-memory/proposals`,
      {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ content: lateCanary, category: 'fact' }),
      },
    );
    expect(lateProposal.status).toBe(201);
    const lateBody = (await lateProposal.json()) as {
      proposal: { proposal_id: string };
    };
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/workspace-memory/proposals/${lateBody.proposal.proposal_id}/review`,
          {
            method: 'POST',
            headers: jsonAuth,
            body: JSON.stringify({ action: 'accept' }),
          },
        )
      ).status,
    ).toBe(200);
    const snapshotsAfterLate = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/snapshots`,
        { headers: auth },
      )
    ).json()) as {
      snapshots: Array<{
        snapshotId: string;
        contentHash: string;
        version: number;
        projectionStatus: string;
      }>;
    };
    const laterSnapshot = snapshotsAfterLate.snapshots.find(
      (snapshot) =>
        snapshot.version > readySnapshot.version &&
        snapshot.projectionStatus === 'ready',
    );
    expect(laterSnapshot).toBeDefined();
    expect(laterSnapshot?.snapshotId).not.toBe(readySnapshot.snapshotId);
    expect(laterSnapshot?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const entriesAfterLate = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/entries`,
        { headers: auth },
      )
    ).json()) as { entries: Array<{ content: string }> };
    expect(entriesAfterLate.entries.map((entry) => entry.content)).toContain(
      lateCanary,
    );
    expect(entriesAfterLate.entries.map((entry) => entry.content)).toContain(
      acceptedCanary,
    );
    expect(
      entriesAfterLate.entries.map((entry) => entry.content),
    ).not.toContain(rejectedCanary);
    await waitForSocketRun(recallBody.run_id, 'succeeded');
    const recallPrompt = runtime.prompts.at(-1) ?? '';
    expect(recallPrompt).toContain(acceptedCanary);
    expect(recallPrompt).not.toContain(rejectedCanary);
    expect(recallPrompt).not.toContain(lateCanary);
    expect(recallPrompt).not.toContain(canaryMessage);
    expect(recallPrompt).not.toContain(lateCanary);
    const secondMessages = (await (
      await fetch(`${baseUrl}/api/v1/sessions/${secondId}/messages`, {
        headers: auth,
      })
    ).json()) as { messages: Array<{ role: string; text: string }> };
    expect(secondMessages.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          text: expect.stringContaining(acceptedCanary),
        }),
      ]),
    );
    const recalledAssistant = secondMessages.messages.filter(
      (item) => item.role === 'assistant',
    );
    expect(recalledAssistant).toHaveLength(1);
    expect(recalledAssistant[0]?.text).toContain(acceptedCanary);
    expect(recalledAssistant[0]?.text).not.toContain(rejectedCanary);
    expect(recalledAssistant[0]?.text).not.toContain(lateCanary);
    expect(
      secondMessages.messages
        .filter((item) => item.role === 'user')
        .map((item) => item.text),
    ).toEqual(['What is the exact constraint?']);
    const secondWorkspace = await fetch(`${baseUrl}/api/v1/workspaces`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({ name: 'Isolated Workspace' }),
    });
    const secondWorkspaceId = (
      (await secondWorkspace.json()) as { workspace_id: string }
    ).workspace_id;
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/workspaces/${secondWorkspaceId}/memory/entries`,
          { headers: auth },
        )
      ).status,
    ).toBe(200);
    const secondWorkspaceEntries = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${secondWorkspaceId}/memory/entries`,
        { headers: auth },
      )
    ).json()) as {
      entries: Array<{
        content: string;
        sourceRunId?: string;
        sourceTaskId?: string;
      }>;
    };
    const secondWorkspaceProposals = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${secondWorkspaceId}/memory/proposals`,
        { headers: auth },
      )
    ).json()) as { proposals: Array<Record<string, unknown>> };
    const secondWorkspaceSnapshots = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${secondWorkspaceId}/memory/snapshots`,
        { headers: auth },
      )
    ).json()) as { snapshots: Array<Record<string, unknown>> };
    const isolatedText = JSON.stringify({
      entries: secondWorkspaceEntries.entries,
      proposals: secondWorkspaceProposals.proposals,
      snapshots: secondWorkspaceSnapshots.snapshots,
    });
    for (const marker of [
      acceptedCanary,
      rejectedCanary,
      lateCanary,
      messageBody.task_id,
      messageBody.run_id,
      candidate.proposal_id,
      lateBody.proposal.proposal_id,
      readySnapshot.snapshotId,
      laterSnapshot!.snapshotId,
    ])
      expect(isolatedText).not.toContain(marker);
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/entries`,
          {
            headers: {
              authorization: `Bearer ${secondaryServiceAccountToken}`,
            },
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/entries`,
          {
            headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
          },
        )
      ).status,
    ).toBe(200);
  });

  it('proves socket queue durability, cancellation, reset, and dispatcher recovery', async () => {
    runtime.ready = false;
    const queued = await fetch(`${baseUrl}/api/v1/tasks:invoke`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'queued while unavailable' },
        workspace_id: workspaceId,
      }),
    });
    expect(queued.status).toBe(202);
    const queuedBody = (await queued.json()) as { task_id: string };
    expect(
      (
        (await (
          await fetch(`${baseUrl}/api/v1/tasks/${queuedBody.task_id}`, {
            headers: auth,
          })
        ).json()) as { status: string }
      ).status,
    ).toBe('queued');
    runtime.ready = true;
    await waitForTask(queuedBody.task_id, 'completed');
    const session = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: defaultPublishedAgentVersionId,
      }),
    });
    const sessionId = ((await session.json()) as { session_id: string })
      .session_id;
    const a = await postSocketMessage(sessionId, 'A', 'queue-a');
    const b = await postSocketMessage(sessionId, 'B', 'queue-b');
    const c = await postSocketMessage(sessionId, 'C', 'queue-c');
    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
    await waitForTaskStatus(a.task_id, 'active');
    expect(runtime.activeRunIds.has(a.run_id)).toBe(true);
    expect(await taskStatus(b.task_id)).toBe('queued');
    expect(await taskStatus(c.task_id)).toBe('queued');
    const queueTree = (await (
      await fetch(`${baseUrl}/api/v1/tasks/${a.task_id}/tree`, {
        headers: auth,
      })
    ).json()) as {
      tasks: Array<{ task_id: string; status: string }>;
    };
    expect(queueTree.tasks.filter((task) => task.status === 'active')).toEqual([
      expect.objectContaining({ task_id: a.task_id, status: 'active' }),
    ]);
    const cancellation = await fetch(
      `${baseUrl}/api/v1/tasks/${a.task_id}:cancel`,
      { method: 'POST', headers: jsonAuth },
    );
    expect(cancellation.status).toBe(202);
    expect(await cancellation.json()).toMatchObject({
      task_id: a.task_id,
      run_id: a.run_id,
      status: 'cancellation_requested',
    });
    expect(runtime.cancelledRunIds).toContain(a.run_id);
    await waitForTask(a.task_id, 'cancelled');
    await waitForSocketRun(a.run_id, 'cancelled');
    expect(await taskStatus(a.task_id)).toBe('cancelled');
    expect(runtime.activeRunIds.has(a.run_id)).toBe(false);
    expect(await runEventTypes(a.run_id)).toEqual(['started', 'cancelled']);
    await waitForTask(b.task_id, 'completed');
    await waitForTask(c.task_id, 'completed');
    expect(await taskStatus(b.task_id)).toBe('completed');
    expect(await taskStatus(c.task_id)).toBe('completed');
    await waitForSocketRun(b.run_id, 'succeeded');
    await waitForSocketRun(c.run_id, 'succeeded');
    expect(await runEventTime(b.run_id, 'succeeded')).toBeLessThanOrEqual(
      await runEventTime(c.run_id, 'started'),
    );
    expect(await runEventTypes(b.run_id)).toEqual([
      'started',
      'output',
      'succeeded',
    ]);
    expect(await runEventTypes(c.run_id)).toEqual([
      'started',
      'output',
      'succeeded',
    ]);
    const queueMessages = (await (
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
      })
    ).json()) as {
      messages: Array<{
        role: string;
        text: string;
        taskId?: string;
        runId?: string;
      }>;
    };
    const queueAssistants = queueMessages.messages.filter(
      (message) => message.role === 'assistant',
    );
    expect(queueAssistants).toHaveLength(2);
    expect(queueAssistants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: b.task_id, runId: b.run_id }),
        expect.objectContaining({ taskId: c.task_id, runId: c.run_id }),
      ]),
    );
    expect(queueAssistants).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: a.task_id, runId: a.run_id }),
      ]),
    );
    expect(
      queueMessages.messages.filter(
        (message) =>
          message.taskId === b.task_id || message.taskId === c.task_id,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: b.task_id, generation: 0 }),
        expect.objectContaining({ taskId: c.task_id, generation: 0 }),
      ]),
    );
    const reset = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}:reset`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'socket-reset' },
    });
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as { generation: number }).generation).toBe(1);
    const newMessage = await postSocketMessage(
      sessionId,
      'new generation',
      'queue-new',
    );
    expect(newMessage.generation).toBe(1);
    expect(newMessage.sequence).toBe(1);
    await waitForTask(newMessage.task_id, 'completed');
    expect(newMessage.task_id).not.toBe(a.task_id);
    expect(newMessage.run_id).not.toBe(a.run_id);
    const resetTask = (
      await databaseControl.database!.query(
        'SELECT generation, lane_sequence FROM tasks WHERE id=$1',
        [newMessage.task_id],
      )
    ).rows[0] as { generation: number; lane_sequence: number };
    expect(resetTask).toEqual({ generation: 1, lane_sequence: 1 });
    const resetRun = (await (
      await fetch(`${baseUrl}/api/v1/runs/${newMessage.run_id}`, {
        headers: auth,
      })
    ).json()) as { status: string };
    expect(resetRun.status).toBe('succeeded');
    const resetMessages = (await (
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
      })
    ).json()) as {
      messages: Array<{
        role: string;
        text: string;
        taskId?: string;
        runId?: string;
        generation?: number;
      }>;
    };
    const resetAssistants = resetMessages.messages.filter(
      (item) =>
        item.role === 'assistant' &&
        item.taskId === newMessage.task_id &&
        item.runId === newMessage.run_id &&
        item.generation === 1,
    );
    expect(resetAssistants).toHaveLength(1);
    expect(resetAssistants).toEqual([
      expect.objectContaining({
        taskId: newMessage.task_id,
        runId: newMessage.run_id,
        generation: 1,
        text: `RECALL_FROM_MEMORY: ## fact

Accepted workspace fact.

## fact

Late-after-admission fact.

## project_constraint

${acceptedCanary}

## fact

${lateCanary}
`,
      }),
    ]);
    expect(b.run_id).not.toBe(c.run_id);

    await dispatcherControl.dispatcher?.stop();
    const paused = await postSocketMessage(sessionId, 'paused', 'queue-paused');
    expect(await taskStatus(paused.task_id)).toBe('queued');
    expect(await runEventTypes(paused.run_id)).toEqual([]);
    const pausedBeforeRestart = (await (
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
      })
    ).json()) as {
      messages: Array<{
        role: string;
        text: string;
        taskId?: string;
        runId?: string;
      }>;
    };
    expect(pausedBeforeRestart.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          text: 'paused',
          taskId: paused.task_id,
          runId: paused.run_id,
        }),
      ]),
    );
    dispatcherControl.dispatcher?.start();
    await waitForTask(paused.task_id, 'completed');
    await waitForSocketRun(paused.run_id, 'succeeded');
    expect(
      runtime.executionRunIds.filter((runId) => runId === paused.run_id),
    ).toHaveLength(1);
    expect(await runEventTypes(paused.run_id)).toEqual([
      'started',
      'output',
      'succeeded',
    ]);
    const pausedMessages = (await (
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
      })
    ).json()) as { messages: Array<{ role: string; text: string }> };
    expect(
      pausedMessages.messages.filter(
        (item) =>
          item.role === 'assistant' &&
          (item as { taskId?: string; runId?: string }).taskId ===
            paused.task_id &&
          (item as { taskId?: string; runId?: string }).runId === paused.run_id,
      ).length,
    ).toBe(1);
  });
});

async function waitForSocketRun(
  runId: string,
  expectedStatus: 'succeeded' | 'failed' | 'cancelled' | 'timed_out',
): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const body = (await (
      await fetch(`${socketBaseUrl}/api/v1/runs/${runId}`, { headers: auth })
    ).json()) as { status: string };
    if (
      ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(body.status)
    ) {
      expect(body.status).toBe(expectedStatus);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run did not terminate: ${runId}`);
}

async function waitForTask(
  taskId: string,
  expectedStatus: 'running' | 'completed' | 'failed' | 'cancelled',
): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const body = (await (
      await fetch(`${socketBaseUrl}/api/v1/tasks/${taskId}`, { headers: auth })
    ).json()) as { status: string };
    if (body.status === expectedStatus) return;
    if (['completed', 'failed', 'cancelled'].includes(body.status)) {
      throw new Error(
        `task ${taskId} reached ${body.status}; expected ${expectedStatus}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`task did not terminate: ${taskId}`);
}

async function waitForTaskStatus(
  taskId: string,
  expectedStatus: 'active' | 'queued',
): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if ((await taskStatus(taskId)) === expectedStatus) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`task ${taskId} did not reach ${expectedStatus}`);
}

async function taskStatus(taskId: string): Promise<string> {
  const response = await fetch(`${socketBaseUrl}/api/v1/tasks/${taskId}`, {
    headers: auth,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { status: string }).status;
}

async function runEventTypes(runId: string): Promise<string[]> {
  const response = await fetch(
    `${socketBaseUrl}/api/v1/runs/${runId}/events?after=0`,
    { headers: auth },
  );
  expect(response.status).toBe(200);
  return (
    (await response.json()) as { events: Array<{ type: string }> }
  ).events.map((event) => event.type);
}

async function runEventTime(runId: string, type: string): Promise<number> {
  const response = await fetch(
    `${socketBaseUrl}/api/v1/runs/${runId}/events?after=0`,
    { headers: auth },
  );
  const body = (await response.json()) as {
    events: Array<{ type: string; created_at: string }>;
  };
  const event = body.events.find((item) => item.type === type);
  expect(event).toBeDefined();
  return Date.parse(event!.created_at);
}

async function postSocketMessage(
  sessionId: string,
  text: string,
  key: string,
): Promise<{
  task_id: string;
  run_id: string;
  generation: number;
  sequence: number;
}> {
  const response = await fetch(
    `${socketBaseUrl}/api/v1/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': key },
      body: JSON.stringify({ text }),
    },
  );
  expect(response.status).toBe(202);
  return (await response.json()) as {
    task_id: string;
    run_id: string;
    generation: number;
    sequence: number;
  };
}
