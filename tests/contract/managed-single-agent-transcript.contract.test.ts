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
    const uniqueToken = 'MEMORY_TOKEN_H_MINIMUM_7F3A';
    const rejectedToken = 'MEMORY_TOKEN_REJECTED_4C91';
    const lateToken = 'MEMORY_TOKEN_LATE_8B20';
    const foreignToken = 'MEMORY_TOKEN_FOREIGN_2D77';
    const runtime = new FakeAgentRuntime({
      responseText: 'TRANSCRIPT_OK',
      delayMs: 25,
    });
    const productWorkspaceId = '00000000-0000-4000-8000-00000000a0bc';
    const app = await createTestApp(runtime, {
      startDispatcher: true,
      workspaceId: productWorkspaceId,
      seedPublishedEnvironment: true,
    });
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

    const workspace = await app.request(
      `/api/v1/workspaces/${productWorkspaceId}`,
      {
        method: 'GET',
        headers,
      },
    );
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
    expect(
      runtime.prompts.every((prompt) => !prompt.includes(uniqueToken)),
    ).toBe(true);
    const events = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events?after=0`,
      { headers },
    );
    const eventBody = (await events.json()) as {
      events: Array<{
        sequence: number;
        type: string;
        payload: Record<string, unknown>;
      }>;
      next_cursor: number | null;
    };
    expect(eventBody.events[0]?.type).toBe('started');
    expect(eventBody.events.at(-1)?.type).toBe('succeeded');
    expect(eventBody.events.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        { kind: 'execution_stage', stage: 'agent_executor_started' },
        { kind: 'execution_stage', stage: 'runtime_execute_requested' },
      ]),
    );
    expect(eventBody.next_cursor).toBeNull();
    const resumed = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events?after=1`,
      { headers },
    );
    expect(
      (
        (await resumed.json()) as {
          events: Array<{ type: string; payload: Record<string, unknown> }>;
        }
      ).events.map((event) => event.type),
    ).toEqual(expect.arrayContaining(['output', 'succeeded']));
    const stream = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events/stream`,
      { headers },
    );
    expect(stream.status).toBe(200);
    expect(await stream.text()).toContain('event: succeeded');

    const accepted = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: uniqueToken,
        category: 'fact',
        source_task_id: messageBody.task_id,
      }),
    });
    const rejected = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: rejectedToken,
        category: 'fact',
        source_task_id: messageBody.task_id,
      }),
    });
    expect(accepted.status).toBe(201);
    expect(rejected.status).toBe(201);
    const acceptedId = (
      (await accepted.json()) as { proposal: { proposal_id: string } }
    ).proposal.proposal_id;
    const rejectedId = (
      (await rejected.json()) as { proposal: { proposal_id: string } }
    ).proposal.proposal_id;
    const acceptedReview = await app.request(
      `/api/v1/workspace-memory/proposals/${acceptedId}/review`,
      { method: 'POST', headers, body: JSON.stringify({ action: 'accept' }) },
    );
    expect(acceptedReview.status).toBe(200);
    const acceptedReviewBody = (await acceptedReview.json()) as {
      proposal: { source_task_id: string | null };
      entry: { source_task_id: string | null } | null;
    };
    expect(acceptedReviewBody.proposal.source_task_id).toBe(
      messageBody.task_id,
    );
    expect(acceptedReviewBody.entry?.source_task_id).toBe(messageBody.task_id);
    const snapshots = await app.request(
      `/api/v1/workspaces/${workspaceId}/memory/snapshots`,
      { headers },
    );
    expect(snapshots.status).toBe(200);
    expect(
      (
        (await snapshots.json()) as {
          snapshots: Array<{ workspaceId: string }>;
        }
      ).snapshots.every((snapshot) => snapshot.workspaceId === workspaceId),
    ).toBe(true);
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
    const late = await app.request('/api/v1/workspace-memory/proposals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: lateToken, category: 'fact' }),
    });
    expect(late.status).toBe(201);
    const foreignProposal = await app.request(
      '/api/v1/workspace-memory/proposals',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secondaryServiceAccountToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          content: foreignToken,
          category: 'fact',
          source_task_id: messageBody.task_id,
        }),
      },
    );
    expect(foreignProposal.status).toBe(404);
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
      runtime.prompts.some((prompt) => prompt.includes(uniqueToken)),
    );
    expect(runtime.prompts.join('\n')).toContain(uniqueToken);
    expect(runtime.prompts.join('\n')).not.toContain(rejectedToken);
    expect(runtime.prompts.join('\n')).not.toContain(lateToken);
    expect(runtime.prompts.join('\n')).not.toContain(foreignToken);
    const transcriptMessages = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      { headers },
    );
    expect(await transcriptMessages.text()).toContain('assistant');

    const cancellable = await app.request(
      `/api/v1/sessions/${secondSessionId}/messages`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': 'transcript-cancellable-message',
        },
        body: JSON.stringify({ text: 'cancel this turn' }),
      },
    );
    const cancellableBody = (await cancellable.json()) as {
      task_id: string;
      run_id: string;
    };
    await wait(async () => {
      const response = await app.request(
        `/api/v1/runs/${cancellableBody.run_id}/events`,
        { headers },
      );
      const body = (await response.json()) as {
        events: Array<{ type: string }>;
      };
      return body.events.some((event) => event.type === 'started');
    });
    const cancellation = await app.request(
      `/api/v1/tasks/${cancellableBody.task_id}:cancel`,
      { method: 'POST', headers },
    );
    expect([200, 202]).toContain(cancellation.status);
    expect(['cancellation_requested', 'cancelled', 'terminal']).toContain(
      ((await cancellation.json()) as { status: string }).status,
    );
    await wait(async () =>
      ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(
        (
          (await (
            await app.request(`/api/v1/runs/${cancellableBody.run_id}`, {
              headers,
            })
          ).json()) as { status: string }
        ).status,
      ),
    );
    const cancelledRun = (await (
      await app.request(`/api/v1/runs/${cancellableBody.run_id}`, { headers })
    ).json()) as { status: string };
    expect(cancelledRun.status).toBe('cancelled');
    const cancelledEvents = (await (
      await app.request(`/api/v1/runs/${cancellableBody.run_id}/events`, {
        headers,
      })
    ).json()) as { events: Array<{ type: string }> };
    expect(cancelledEvents.events[0]?.type).toBe('started');
    expect(cancelledEvents.events.at(-1)?.type).toBe('cancelled');

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
    const foreignEvents = await app.request(
      `/api/v1/runs/${messageBody.run_id}/events`,
      { headers: { authorization: `Bearer ${secondaryServiceAccountToken}` } },
    );
    expect(foreignEvents.status).toBe(404);
  });
});
