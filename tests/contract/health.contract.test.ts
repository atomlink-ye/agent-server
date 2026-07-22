import { describe, expect, it } from 'vitest';

import {
  LivenessResponseSchema,
  ReadinessResponseSchema,
} from '../../src/contracts/health.js';
import { ErrorResponseSchema } from '../../src/contracts/http.js';
import { createTestApp } from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

describe('health HTTP contracts', () => {
  it('returns the stable liveness response', async () => {
    const app = await createTestApp(new FakeAgentRuntime());
    const response = await app.request('/health/live');

    expect(response.status).toBe(200);
    expect(LivenessResponseSchema.parse(await response.json())).toMatchObject({
      status: 'ok',
      service: 'agent-server-test',
    });
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('returns not-ready with a dependency-safe detail', async () => {
    const app = await createTestApp(new FakeAgentRuntime({ ready: false }));
    const response = await app.request('/health/ready');

    expect(response.status).toBe(503);
    expect(ReadinessResponseSchema.parse(await response.json())).toEqual({
      status: 'not_ready',
      service: 'agent-server-test',
      checks: [
        {
          name: 'fake_runtime',
          status: 'not_ready',
          detail: 'fake runtime unavailable',
        },
      ],
    });
  });

  it('uses the common error envelope for unknown routes', async () => {
    const app = await createTestApp(new FakeAgentRuntime());
    const response = await app.request('/missing', {
      headers: { 'x-request-id': 'request-contract-1' },
    });

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json())).toEqual({
      error: {
        code: 'route_not_found',
        message: 'The requested route does not exist.',
        request_id: 'request-contract-1',
      },
    });
  });
});
