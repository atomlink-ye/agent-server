import { describe, expect, it } from 'vitest';

import { ErrorResponseSchema } from '../../src/contracts/http.js';
import {
  CreateRunResponseSchema,
  GetRunResponseSchema,
} from '../../src/contracts/runs.js';
import { createTestApp } from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

describe('run HTTP contracts', () => {
  it('accepts a valid prompt asynchronously', async () => {
    const app = createTestApp(new FakeAgentRuntime());
    const response = await app.request('/api/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Reply with exactly: BASELINE_OK' }),
    });

    expect(response.status).toBe(202);
    const body = CreateRunResponseSchema.parse(await response.json());
    expect(body.status).toBe('queued');
    expect(body.links.self).toBe(`/api/v1/runs/${body.run_id}`);
  });

  it.each([
    [{}, 'invalid_request'],
    [{ prompt: 'ok', model: 'opencode/paid' }, 'invalid_request'],
  ])('rejects invalid input %#', async (body, code) => {
    const response = await createTestApp(new FakeAgentRuntime()).request(
      '/api/v1/runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      code,
    );
  });

  it('rejects a request body larger than 64 KiB', async () => {
    const response = await createTestApp(new FakeAgentRuntime()).request(
      '/api/v1/runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'x'.repeat(70_000) }),
      },
    );

    expect(response.status).toBe(413);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'request_too_large',
    );
  });

  it('returns 503 before accepting work when runtime readiness fails', async () => {
    const response = await createTestApp(
      new FakeAgentRuntime({ ready: false }),
    ).request('/api/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    expect(response.status).toBe(503);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'runtime_unavailable',
    );
  });

  it('returns 404 for an unknown run', async () => {
    const response = await createTestApp(new FakeAgentRuntime()).request(
      '/api/v1/runs/00000000-0000-4000-8000-000000000000',
    );

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'run_not_found',
    );
  });

  it('returns a stable terminal representation without the prompt', async () => {
    const app = createTestApp(
      new FakeAgentRuntime({ responseText: 'CONTRACT_OK' }),
    );
    const created = CreateRunResponseSchema.parse(
      await (
        await app.request('/api/v1/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'private prompt' }),
        })
      ).json(),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await app.request(created.links.self);
    const body = GetRunResponseSchema.parse(await response.json());

    expect(body.status).toBe('succeeded');
    expect(body.result?.text).toBe('CONTRACT_OK');
    expect(JSON.stringify(body)).not.toContain('private prompt');
  });
});
