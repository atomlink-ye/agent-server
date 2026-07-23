import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  primaryServiceAccountToken,
} from '../tests/fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../tests/fixtures/fake-agent-runtime.js';

const workspaceId = '00000000-0000-4000-8000-00000000f001';
const auth = { authorization: `Bearer ${primaryServiceAccountToken}` };
const jsonAuth = { ...auth, 'content-type': 'application/json' };

describe('managed single-agent memory recall', () => {
  let server: ServerType;
  let baseUrl: string;
  let runtime: FakeAgentRuntime;

  beforeAll(async () => {
    runtime = new FakeAgentRuntime({ responseText: 'FRESH_SESSION_OK' });
    const app = await createTestApp(runtime, { workspaceId });
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening)
      await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('E2E server did not expose a TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
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
});
