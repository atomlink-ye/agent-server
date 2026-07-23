import { describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

const headers = (token: string, key?: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  ...(key ? { 'idempotency-key': key } : {}),
});

describe('Phase C session contracts', () => {
  it('creates and reads a private workspace/session and admits durable messages', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const workspaceResponse = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: headers(primaryServiceAccountToken),
      body: JSON.stringify({ name: 'Product workspace' }),
    });
    expect(workspaceResponse.status).toBe(201);
    const workspace = (await workspaceResponse.json()) as {
      workspace_id: string;
    };

    const sessionResponse = await app.request('/api/v1/sessions', {
      method: 'POST',
      headers: headers(primaryServiceAccountToken),
      body: JSON.stringify({
        workspace_id: workspace.workspace_id,
        agent_version_id: defaultPublishedAgentVersionId,
      }),
    });
    expect(sessionResponse.status).toBe(201);
    const session = (await sessionResponse.json()) as {
      session_id: string;
      generation: number;
    };

    const messageResponse = await app.request(
      `/api/v1/sessions/${session.session_id}/messages`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'message-1'),
        body: JSON.stringify({ text: 'first user message' }),
      },
    );
    expect(messageResponse.status).toBe(202);
    const message = (await messageResponse.json()) as {
      message_id: string;
      session_id: string;
      generation: number;
      sequence: number;
      task_id: string;
      run_id: string;
      status: string;
    };
    expect(message).toMatchObject({
      session_id: session.session_id,
      generation: 0,
      sequence: 1,
      status: 'queued',
    });
    expect(message.message_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(message.task_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(message.run_id).toMatch(/^[0-9a-f-]{36}$/);

    expect(
      (
        await app.request(`/api/v1/workspaces/${workspace.workspace_id}`, {
          headers: headers(primaryServiceAccountToken),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/sessions/${session.session_id}/messages`, {
          headers: headers(primaryServiceAccountToken),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/tasks/${message.task_id}`, {
          headers: headers(primaryServiceAccountToken),
        })
      ).status,
    ).toBe(200);

    for (const path of [
      `/api/v1/workspaces/${workspace.workspace_id}`,
      `/api/v1/sessions/${session.session_id}`,
      `/api/v1/sessions/${session.session_id}/messages`,
      `/api/v1/tasks/${message.task_id}`,
    ]) {
      expect(
        (
          await app.request(path, {
            headers: headers(secondaryServiceAccountToken),
          })
        ).status,
      ).toBe(404);
    }

    const reset = await app.request(
      `/api/v1/sessions/${session.session_id}:reset`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'reset-1'),
      },
    );
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as { generation: number }).generation).toBe(1);
    const messagesAfterReset = await app.request(
      `/api/v1/sessions/${session.session_id}/messages`,
      { headers: headers(primaryServiceAccountToken) },
    );
    expect(
      ((await messagesAfterReset.json()) as { messages: unknown[] }).messages,
    ).toHaveLength(1);
  });
});
