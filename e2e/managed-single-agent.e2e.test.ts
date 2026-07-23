import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
} from '../tests/fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../tests/fixtures/fake-agent-runtime.js';

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

describe('managed single-agent memory recall', () => {
  let server: ServerType;
  let baseUrl: string;
  let runtime: FakeAgentRuntime;

  beforeAll(async () => {
    runtime = new FakeAgentRuntime({
      responseText: 'FRESH_SESSION_OK',
      delayMs: 10,
      memoryCandidates: [
        { content: 'CANARY_CONSTRAINT_UNIQUE_7F31', category: 'constraint' },
      ],
    });
    const app = await createTestApp(runtime, { workspaceId });
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening)
      await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('E2E server did not expose a TCP address');
    baseUrl = socketBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
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
      ).snapshots[0]?.projectionStatus,
    ).toBe('ready');

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
          text: 'FRESH_SESSION_OK',
        }),
      ]),
    );
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
    const oldTaskResponse = await fetch(`${baseUrl}/api/v1/tasks:invoke`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'socket-old-v1' },
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'old version pin' },
        workspace_id: workspaceId,
      }),
    });
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
    const imported = await fetch(`${baseUrl}/api/v1/agents:import`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'socket-canary-import' },
      body: JSON.stringify({ source: canarySource }),
    });
    expect(imported.status).toBe(201);
    const importedBody = (await imported.json()) as { version: { id: string } };
    await waitForTask(oldTaskId);
    expect(
      runtime.prompts.some((prompt) => prompt.includes('Do the task.')),
    ).toBe(true);
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/agent-versions/${importedBody.version.id}:publish`,
          {
            method: 'POST',
            headers: {
              ...jsonAuth,
              'idempotency-key': 'socket-canary-publish',
            },
            body: '{}',
          },
        )
      ).status,
    ).toBe(200);
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
    const message = await fetch(
      `${baseUrl}/api/v1/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: { ...jsonAuth, 'idempotency-key': 'socket-canary-message' },
        body: JSON.stringify({
          text: 'Research competitors under CANARY_CONSTRAINT_UNIQUE_7F31.',
        }),
      },
    );
    expect(message.status).toBe(202);
    const messageBody = (await message.json()) as {
      task_id: string;
      run_id: string;
    };
    await waitForSocketRun(messageBody.run_id);
    const proposals = (await (
      await fetch(`${baseUrl}/api/v1/workspace-memory/proposals`, {
        headers: auth,
      })
    ).json()) as {
      proposals: Array<{
        proposal_id: string;
        content: string;
        source_task_id: string | null;
      }>;
    };
    const candidate = proposals.proposals.find(
      (proposal) => proposal.content === 'CANARY_CONSTRAINT_UNIQUE_7F31',
    );
    expect(candidate).toMatchObject({ source_task_id: messageBody.task_id });
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
        taskId?: string;
        task_id?: string;
        runId?: string;
        run_id?: string;
      }>;
    };
    expect(
      sourceMessages.messages.some(
        (item) =>
          (item.taskId ?? item.task_id) === messageBody.task_id &&
          (item.runId ?? item.run_id) === messageBody.run_id,
      ),
    ).toBe(true);
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
    const firstSse = await fetch(
      `${baseUrl}/api/v1/runs/${messageBody.run_id}/events/stream`,
      { headers: auth },
    );
    const firstSseText = await firstSse.text();
    expect((firstSseText.match(/event: succeeded/g) ?? []).length).toBe(1);
    const reconnect = await fetch(
      `${baseUrl}/api/v1/runs/${messageBody.run_id}/events/stream`,
      { headers: { ...auth, 'last-event-id': '1' } },
    );
    const reconnectText = await reconnect.text();
    expect(reconnectText).toContain('event: succeeded');
    expect((reconnectText.match(/event: succeeded/g) ?? []).length).toBe(1);
    expect(
      (await (
        await fetch(
          `${baseUrl}/api/v1/workspace-memory/proposals/${candidate!.proposal_id}/review`,
          {
            method: 'POST',
            headers: jsonAuth,
            body: JSON.stringify({ action: 'accept' }),
          },
        )
      ).json()) as object,
    ).toBeTruthy();
    const snapshots = (await (
      await fetch(
        `${baseUrl}/api/v1/workspaces/${workspaceId}/memory/snapshots`,
        { headers: auth },
      )
    ).json()) as {
      snapshots: Array<{ projectionStatus: string; workspaceId: string }>;
    };
    expect(snapshots.snapshots[0]).toMatchObject({
      projectionStatus: 'ready',
      workspaceId,
    });
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
    const recallBody = (await recall.json()) as { run_id: string };
    await waitForSocketRun(recallBody.run_id);
    expect(
      runtime.prompts.some((prompt) =>
        prompt.includes('CANARY_CONSTRAINT_UNIQUE_7F31'),
      ),
    ).toBe(true);
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
    await waitForTask(queuedBody.task_id);
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
    const cancellation = await fetch(
      `${baseUrl}/api/v1/tasks/${a.task_id}:cancel`,
      { method: 'POST', headers: jsonAuth },
    );
    expect([200, 202]).toContain(cancellation.status);
    await waitForTask(b.task_id);
    await waitForTask(c.task_id);
    const reset = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}:reset`, {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': 'socket-reset' },
    });
    expect(reset.status).toBe(200);
    const newMessage = await postSocketMessage(
      sessionId,
      'new generation',
      'queue-new',
    );
    await waitForTask(newMessage.task_id);
    expect(
      await (
        await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
          headers: auth,
        })
      ).text(),
    ).toContain('assistant');
    expect(b.run_id).not.toBe(c.run_id);
  });
});

async function waitForSocketRun(runId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const body = (await (
      await fetch(`${socketBaseUrl}/api/v1/runs/${runId}`, { headers: auth })
    ).json()) as { status: string };
    if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(body.status))
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run did not terminate: ${runId}`);
}

async function waitForTask(taskId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const body = (await (
      await fetch(`${socketBaseUrl}/api/v1/tasks/${taskId}`, { headers: auth })
    ).json()) as { status: string };
    if (['completed', 'failed', 'cancelled'].includes(body.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`task did not terminate: ${taskId}`);
}

async function postSocketMessage(
  sessionId: string,
  text: string,
  key: string,
): Promise<{ task_id: string; run_id: string }> {
  const response = await fetch(
    `${socketBaseUrl}/api/v1/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      headers: { ...jsonAuth, 'idempotency-key': key },
      body: JSON.stringify({ text }),
    },
  );
  expect(response.status).toBe(202);
  return (await response.json()) as { task_id: string; run_id: string };
}
