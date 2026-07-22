import { describe, expect, it } from 'vitest';

import { ErrorResponseSchema } from '../../src/contracts/http.js';
import {
  GetTaskResponseSchema,
  GetTaskTreeResponseSchema,
  InvokeTaskResponseSchema,
} from '../../src/contracts/tasks.js';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  disabledServiceAccountToken,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

const authenticatedJsonHeaders = {
  authorization: `Bearer ${primaryServiceAccountToken}`,
  'content-type': 'application/json',
};

describe('task HTTP contracts', () => {
  it.each([
    [{}, 'missing'],
    [{ authorization: 'Basic nope' }, 'malformed'],
    [{ authorization: 'Bearer token-unknown' }, 'unknown'],
    [{ authorization: `Bearer ${disabledServiceAccountToken}` }, 'disabled'],
  ])(
    'returns the same public 401 for %s bearer auth failure',
    async (headers, _reason) => {
      const app = await createTestApp(new FakeAgentRuntime(), {
        startDispatcher: false,
      });
      const response = await app.request('/api/v1/tasks:invoke', {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'x-request-id': 'req-unauthorized',
        },
        body: JSON.stringify({
          invokable: {
            kind: 'agent',
            version_id: defaultPublishedAgentVersionId,
          },
          input: { text: 'Reply with exactly: TASK_OK' },
        }),
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

  it('accepts canonical task invoke without checking runtime readiness first', async () => {
    const app = await createTestApp(new FakeAgentRuntime({ ready: false }), {
      startDispatcher: false,
    });
    const response = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'Reply with exactly: TASK_OK' },
      }),
    });

    expect(response.status).toBe(202);
    const body = InvokeTaskResponseSchema.parse(await response.json());
    expect(Object.keys(body).sort()).toEqual(['links', 'status', 'task_id']);
    expect(body.status).toBe('queued');
    expect(body.links.self).toBe(`/api/v1/tasks/${body.task_id}`);
    expect(body.links.tree).toBe(`/api/v1/tasks/${body.task_id}/tree`);
  });

  it('reuses the original task for the same idempotency key and canonical request', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const headers = {
      ...authenticatedJsonHeaders,
      'idempotency-key': 'same-key',
    };

    const first = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'same prompt' },
      }),
    });
    const second = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        workspace_id: 'workspace_main',
        input: { text: '  same prompt  ' },
      }),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    const firstBody = InvokeTaskResponseSchema.parse(await first.json());
    const secondBody = InvokeTaskResponseSchema.parse(await second.json());

    expect(secondBody.task_id).toBe(firstBody.task_id);
    expect(secondBody.links.self).toBe(firstBody.links.self);
    expect(secondBody.links.tree).toBe(firstBody.links.tree);
  });

  it('returns conflict when the same Idempotency-Key is reused with a different canonical body', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const headers = {
      ...authenticatedJsonHeaders,
      'idempotency-key': 'same-key',
    };

    const first = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'first prompt' },
      }),
    });
    const second = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'different prompt' },
      }),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(ErrorResponseSchema.parse(await second.json()).error.code).toBe(
      'idempotency_conflict',
    );
  });

  it('returns 403 when workspace_id does not match the authenticated workspace', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const response = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        workspace_id: 'workspace_other',
        input: { text: 'scope mismatch' },
      }),
    });

    expect(response.status).toBe(403);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'workspace_scope_mismatch',
    );
  });

  it('returns 404 for an unknown invokable reference', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const response = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers: authenticatedJsonHeaders,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: '00000000-0000-4000-8000-00000000ffff',
        },
        input: { text: 'missing invokable' },
      }),
    });

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'invokable_not_found',
    );
  });

  it('returns 404 when a different owner in the same tenant invokes a published version it does not own', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const response = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secondaryServiceAccountToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'missing shared acl' },
      }),
    });

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'invokable_not_found',
    );
  });

  it('returns the canonical task resource and task tree for the authenticated owner', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const created = InvokeTaskResponseSchema.parse(
      await (
        await app.request('/api/v1/tasks:invoke', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            invokable: {
              kind: 'agent',
              version_id: defaultPublishedAgentVersionId,
            },
            input: { text: 'owner scoped prompt' },
          }),
        })
      ).json(),
    );

    const taskResponse = await app.request(created.links.self, {
      headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
    });
    const treeResponse = await app.request(created.links.tree, {
      headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
    });

    expect(taskResponse.status).toBe(200);
    expect(treeResponse.status).toBe(200);

    const task = GetTaskResponseSchema.parse(await taskResponse.json());
    const tree = GetTaskTreeResponseSchema.parse(await treeResponse.json());

    expect(task.task_id).toBe(created.task_id);
    expect(task.root_task_id).toBe(created.task_id);
    expect(task.parent_task_id).toBeNull();
    expect(task.parent_run_id).toBeNull();
    expect(task.invokable).toEqual({
      kind: 'agent',
      version_id: defaultPublishedAgentVersionId,
    });
    expect(task.latest_run?.status).toBe('queued');
    expect(JSON.stringify(task)).not.toContain('owner scoped prompt');

    expect(tree.root_task_id).toBe(created.task_id);
    expect(tree.tasks).toHaveLength(1);
    expect(tree.tasks[0]?.task_id).toBe(created.task_id);
  });

  it('returns 404 task_not_found when a different authenticated owner reads an existing task', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const created = InvokeTaskResponseSchema.parse(
      await (
        await app.request('/api/v1/tasks:invoke', {
          method: 'POST',
          headers: authenticatedJsonHeaders,
          body: JSON.stringify({
            invokable: {
              kind: 'agent',
              version_id: defaultPublishedAgentVersionId,
            },
            input: { text: 'owner scoped prompt' },
          }),
        })
      ).json(),
    );

    const response = await app.request(created.links.self, {
      headers: {
        authorization: `Bearer ${secondaryServiceAccountToken}`,
      },
    });

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'task_not_found',
    );
  });
});
