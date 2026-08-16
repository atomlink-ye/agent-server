import { describe, expect, it } from 'vitest';

import { ErrorResponseSchema } from '../../src/contracts/http.js';
import {
  CreateRunResponseSchema,
  GetRunResponseSchema,
} from '../../src/contracts/runs.js';
import {
  createTestApp,
  disabledServiceAccountToken,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
  defaultPublishedAgentVersionId,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

const authenticatedJsonHeaders = {
  authorization: `Bearer ${primaryServiceAccountToken}`,
  'content-type': 'application/json',
};

describe('run HTTP contracts', () => {
  it('authorizes event reads for a product-session run by principal ownership', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      seedPublishedEnvironment: true,
    });
    const workspace = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({ name: 'events' }),
    });
    const workspaceId = ((await workspace.json()) as { workspace_id: string })
      .workspace_id;
    const session = await app.request('/api/v1/sessions', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: defaultPublishedAgentVersionId,
      }),
    });
    const sessionId = ((await session.json()) as { session_id: string })
      .session_id;
    const message = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({ text: 'events' }),
      },
    );
    const runId = ((await message.json()) as { run_id: string }).run_id;
    const owned = await app.request(`/api/v1/runs/${runId}/events`, {
      headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
    });
    expect(owned.status).toBe(200);
    const foreign = await app.request(`/api/v1/runs/${runId}/events`, {
      headers: { authorization: `Bearer ${secondaryServiceAccountToken}` },
    });
    expect(foreign.status).toBe(404);
  });

  it('exposes execution stages while an accepted Run remains active', async () => {
    const runtime = new FakeAgentRuntime();
    const gate = runtime.armExecutionGate();
    const app = await createTestApp(runtime);
    const accepted = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({ prompt: 'hold until event read' }),
    });
    expect(accepted.status).toBe(202);
    const runId = CreateRunResponseSchema.parse(await accepted.json()).run_id;

    await gate.entered;
    const events = await app.request(`/api/v1/runs/${runId}/events?after=0`, {
      headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
    });
    expect(events.status).toBe(200);
    expect(
      (
        (await events.json()) as {
          events: Array<{ type: string; payload: Record<string, unknown> }>;
        }
      ).events.map((event) => event.payload),
    ).toEqual(
      expect.arrayContaining([
        { kind: 'execution_stage', stage: 'agent_executor_started' },
        { kind: 'execution_stage', stage: 'runtime_execute_requested' },
      ]),
    );

    gate.release();
  });

  it.each([
    [{}, 'missing'],
    [{ authorization: 'Basic nope' }, 'malformed'],
    [{ authorization: 'Bearer token-unknown' }, 'unknown'],
    [{ authorization: `Bearer ${disabledServiceAccountToken}` }, 'disabled'],
  ])(
    'returns the same public 401 for %s bearer auth failure',
    async (headers, _reason) => {
      const app = await createTestApp(new FakeAgentRuntime());
      const response = await app.request('/api/v1/runs', {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'x-request-id': 'req-unauthorized',
        },
        body: JSON.stringify({ prompt: 'Reply with exactly: BASELINE_OK' }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(await response.json()).toEqual({
        error: {
          code: 'unauthorized',
          message: 'Authentication is required to access this resource.',
          request_id: 'req-unauthorized',
        },
      });
    },
  );

  it('accepts a valid authenticated prompt asynchronously', async () => {
    const app = await createTestApp(new FakeAgentRuntime());
    const response = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({ prompt: 'Reply with exactly: BASELINE_OK' }),
    });

    expect(response.status).toBe(202);
    const body = CreateRunResponseSchema.parse(await response.json());
    expect(Object.keys(body).sort()).toEqual(['links', 'run_id', 'status']);
    expect(Object.keys(body.links)).toEqual(['self']);
    expect(body.status).toBe('queued');
    expect(body.links.self).toBe(`/api/v1/runs/${body.run_id}`);
  });

  it('reuses the same accepted work for the same Idempotency-Key', async () => {
    const app = await createTestApp(new FakeAgentRuntime());
    const headers = {
      ...authenticatedJsonHeaders,
      'idempotency-key': 'same-key',
    };

    const first = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'same prompt' }),
    });
    const second = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'same prompt' }),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    const firstBody = CreateRunResponseSchema.parse(await first.json());
    const secondBody = CreateRunResponseSchema.parse(await second.json());

    expect(secondBody.run_id).toBe(firstBody.run_id);
    expect(secondBody.links.self).toBe(firstBody.links.self);
  });

  it('replays already accepted work when runtime readiness later turns false', async () => {
    const runtime = new FakeAgentRuntime();
    const app = await createTestApp(runtime);
    const headers = {
      ...authenticatedJsonHeaders,
      'idempotency-key': 'same-key',
    };

    const first = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'same prompt' }),
    });

    runtime.ready = false;

    const second = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'same prompt' }),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    const firstBody = CreateRunResponseSchema.parse(await first.json());
    const secondBody = CreateRunResponseSchema.parse(await second.json());

    expect(secondBody.run_id).toBe(firstBody.run_id);
    expect(secondBody.links.self).toBe(firstBody.links.self);
  });

  it('returns conflict when the same Idempotency-Key is reused with a different body', async () => {
    const app = await createTestApp(new FakeAgentRuntime());
    const headers = {
      ...authenticatedJsonHeaders,
      'idempotency-key': 'same-key',
    };

    const first = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'first prompt' }),
    });
    const second = await app.request('/api/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'different prompt' }),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(ErrorResponseSchema.parse(await second.json()).error.code).toBe(
      'idempotency_conflict',
    );
  });

  it.each([
    [{}, 'invalid_request'],
    [{ prompt: 'ok', model: 'opencode/paid' }, 'invalid_request'],
  ])('rejects invalid input %#', async (body, code) => {
    const app = await createTestApp(new FakeAgentRuntime());
    const response = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      code,
    );
  });

  it('rejects a request body larger than 64 KiB', async () => {
    const app = await createTestApp(new FakeAgentRuntime());
    const response = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({ prompt: 'x'.repeat(70_000) }),
    });

    expect(response.status).toBe(413);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'request_too_large',
    );
  });

  it('returns 503 before accepting work when runtime readiness fails', async () => {
    const app = await createTestApp(new FakeAgentRuntime({ ready: false }));
    const response = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({ prompt: 'test' }),
    });

    expect(response.status).toBe(503);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'runtime_unavailable',
    );
  });

  it('returns 404 for an unknown run', async () => {
    const app = await createTestApp(new FakeAgentRuntime());
    const response = await app.request(
      '/api/v1/runs/00000000-0000-4000-8000-000000000000',
      { headers: { authorization: `Bearer ${primaryServiceAccountToken}` } },
    );

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'run_not_found',
    );
  });

  it('returns a stable terminal representation without the prompt', async () => {
    const app = await createTestApp(
      new FakeAgentRuntime({ responseText: 'CONTRACT_OK' }),
    );
    const created = CreateRunResponseSchema.parse(
      await (
        await app.request('/api/v1/runs', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({ prompt: 'private prompt' }),
        })
      ).json(),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await app.request(created.links.self, {
      headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
    });
    const body = GetRunResponseSchema.parse(await response.json());

    expect(Object.keys(body).sort()).toEqual([
      'created_at',
      'error',
      'result',
      'run_id',
      'runtime',
      'status',
      'updated_at',
      'usage',
    ]);
    expect(body.status).toBe('succeeded');
    expect(body.result?.text).toBe('CONTRACT_OK');
    expect(JSON.stringify(body)).not.toContain('private prompt');
  });

  it('returns 404 run_not_found when an authenticated non-owner reads an existing run', async () => {
    const app = await createTestApp(
      new FakeAgentRuntime({ responseText: 'OWNER_SCOPE_OK' }),
    );
    const created = CreateRunResponseSchema.parse(
      await (
        await app.request('/api/v1/runs', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({ prompt: 'owner scoped prompt' }),
        })
      ).json(),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await app.request(created.links.self, {
      headers: {
        authorization: `Bearer ${secondaryServiceAccountToken}`,
      },
    });

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'run_not_found',
    );
  });
});
