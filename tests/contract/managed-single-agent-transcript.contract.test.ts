import { describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

const headers = {
  authorization: `Bearer ${primaryServiceAccountToken}`,
  'content-type': 'application/json',
};
const source = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Transcript Agent
spec:
  description: transcript
  instructions: Remember the accepted memory.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: input
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 2
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;
const wait = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('transcript timeout');
};

describe('managed single-agent minimum transcript', () => {
  it('runs the validate/import/publish/session/memory/events/reset/idempotency journey', async () => {
    const runtime = new FakeAgentRuntime({ responseText: 'TRANSCRIPT_OK' });
    const app = await createTestApp(runtime, { startDispatcher: true });
    const validate = await app.request('/api/v1/agent-packages:validate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ source }),
    });
    expect(validate.status).toBe(200);
    const imported = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'transcript-import' },
      body: JSON.stringify({ source }),
    });
    expect(imported.status).toBe(201);
    const importedBody = (await imported.json()) as { version: { id: string } };
    const published = await app.request(
      `/api/v1/agent-versions/${importedBody.version.id}:publish`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'transcript-publish' },
        body: '{}',
      },
    );
    expect(published.status).toBe(200);
    const versionId = importedBody.version.id;

    const workspace = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Transcript Workspace' }),
    });
    const workspaceId = ((await workspace.json()) as { workspace_id: string })
      .workspace_id;
    const session = await app.request('/api/v1/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: versionId,
      }),
    });
    const sessionId = ((await session.json()) as { session_id: string })
      .session_id;
    const message = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'transcript-message' },
        body: JSON.stringify({ text: 'first turn' }),
      },
    );
    const messageBody = (await message.json()) as {
      task_id: string;
      run_id: string;
      sequence: number;
    };
    expect(message.status).toBe(202);
    await wait(async () =>
      (
        await app.request(`/api/v1/runs/${messageBody.run_id}/events`, {
          headers,
        })
      )
        .json()
        .then((body: any) =>
          body.events.some((event: any) => event.type === 'succeeded'),
        ),
    );
    const events = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events?after=0`,
      { headers },
    );
    const eventBody = (await events.json()) as {
      events: Array<{ sequence: number; type: string }>;
      next_cursor: number | null;
    };
    expect(eventBody.events.map((event) => event.type)).toEqual([
      'started',
      'output',
      'succeeded',
    ]);
    expect(eventBody.next_cursor).toBeNull();
    const resumed = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events?after=1`,
      { headers },
    );
    expect(
      (
        (await resumed.json()) as { events: Array<{ type: string }> }
      ).events.map((event) => event.type),
    ).toEqual(['output', 'succeeded']);
    const stream = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events/stream`,
      { headers },
    );
    expect(stream.status).toBe(200);
    expect(await stream.text()).toContain('event: succeeded');

    const accepted = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'accepted memory', category: 'fact' }),
    });
    const rejected = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'rejected memory', category: 'fact' }),
    });
    const acceptedId = (
      (await accepted.json()) as { proposal: { proposal_id: string } }
    ).proposal.proposal_id;
    const rejectedId = (
      (await rejected.json()) as { proposal: { proposal_id: string } }
    ).proposal.proposal_id;
    expect(
      (
        await app.request(
          `/api/v1/workspace-memory/proposals/${acceptedId}/review`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ action: 'accept' }),
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/v1/workspace-memory/proposals/${rejectedId}/review`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ action: 'reject' }),
          },
        )
      ).status,
    ).toBe(200);
    const secondSession = await app.request('/api/v1/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: versionId,
      }),
    });
    const secondSessionId = (
      (await secondSession.json()) as { session_id: string }
    ).session_id;
    const secondMessage = await app.request(
      `/api/v1/sessions/${secondSessionId}/messages`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'transcript-second-message' },
        body: JSON.stringify({ text: 'recall' }),
      },
    );
    expect(secondMessage.status).toBe(202);
    await wait(async () =>
      runtime.prompts.some((prompt) => prompt.includes('accepted memory')),
    );
    expect(runtime.prompts.join('\n')).not.toContain('rejected memory');
    const transcriptMessages = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      { headers },
    );
    expect(await transcriptMessages.text()).toContain('assistant');

    const replay = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'transcript-message' },
      body: JSON.stringify({ text: 'first turn' }),
    });
    expect(replay.status).toBe(202);
    expect(((await replay.json()) as { sequence: number }).sequence).toBe(
      messageBody.sequence,
    );
    const reset = await app.request(`/api/v1/sessions/${sessionId}:reset`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'transcript-reset' },
    });
    expect(reset.status).toBe(200);
    const foreign = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events`,
      { headers: { authorization: `Bearer ${secondaryServiceAccountToken}` } },
    );
    expect(foreign.status).toBe(404);
  });
});
