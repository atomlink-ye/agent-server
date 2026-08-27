import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import { registerBrowserWorkOrganizationRoutes } from './browser-work-organization.js';

const SERVICE_TOKEN = 'browser-service-secret';
const ID = '11111111-1111-4111-8111-111111111111';

function app(): Hono<ApiEnvironment> {
  const value = new Hono<ApiEnvironment>();
  registerBrowserWorkOrganizationRoutes(value, {
    port: 3000,
    serviceAccounts: [],
  } as unknown as AppConfig);
  return value;
}

function upstreamError(code: string, message: string) {
  return new Response(
    JSON.stringify({
      error: { code, message, request_id: 'upstream-request' },
    }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_SERVER_SERVICE_TOKEN;
});

describe('browser work-organization BFF', () => {
  for (const [path, code, other] of [
    [`/api/work-items/${ID}`, 'task_not_found', 'work_board_not_found'],
    [`/api/boards/${ID}`, 'work_board_not_found', 'task_not_found'],
  ] as const) {
    it(`forwards ${code} from ${path}`, async () => {
      process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => upstreamError(code, `Upstream ${code}.`)),
      );
      const response = await app().request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: {
          code,
          message: `Upstream ${code}.`,
          request_id: 'upstream-request',
        },
      });
    });

    it(`does not mint ${code} for a different 404 from ${path}`, async () => {
      process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => upstreamError(other, `Upstream ${other}.`)),
      );
      const response = await app().request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: {
          code: other,
          message: `Upstream ${other}.`,
          request_id: 'upstream-request',
        },
      });
    });
  }
});
