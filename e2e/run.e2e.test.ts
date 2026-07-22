import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CreateRunResponseSchema,
  GetRunResponseSchema,
} from '../src/contracts/runs.js';
import { createTestApp } from '../tests/fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../tests/fixtures/fake-agent-runtime.js';

describe('run walking skeleton', () => {
  let server: ServerType;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createTestApp(
      new FakeAgentRuntime({ responseText: 'DETERMINISTIC_E2E_OK' }),
    );
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening) {
      await new Promise<void>((resolve) => server.once('listening', resolve));
    }
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('E2E server did not expose a TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('accepts, executes, and exposes a completed run over a real socket', async () => {
    const ready = await fetch(`${baseUrl}/health/ready`);
    expect(ready.status).toBe(200);

    const createdResponse = await fetch(`${baseUrl}/api/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'deterministic e2e prompt' }),
    });
    expect(createdResponse.status).toBe(202);
    const created = CreateRunResponseSchema.parse(await createdResponse.json());

    let completed: ReturnType<typeof GetRunResponseSchema.parse> | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await fetch(`${baseUrl}${created.links.self}`);
      const run = GetRunResponseSchema.parse(await response.json());
      if (['succeeded', 'failed', 'timed_out'].includes(run.status)) {
        completed = run;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(completed).toMatchObject({
      run_id: created.run_id,
      status: 'succeeded',
      runtime: {
        provider: 'opencode',
        model: 'opencode/fake-free',
      },
      result: { text: 'DETERMINISTIC_E2E_OK' },
    });
  });
});
