import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { registerBrowserContextRoutes } from './browser-context.js';

function config(): AppConfig {
  return { port: 3000, serviceAccounts: [] } as unknown as AppConfig;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_SERVER_SERVICE_TOKEN;
});

describe('browser ContextFS facade', () => {
  it('forwards only the session-derived user identity to scoped context API', async () => {
    const upstream = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('x-agent-server-user-id')).toBe(
          'user-session',
        );
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );
    process.env.AGENT_SERVER_SERVICE_TOKEN = 'internal-test-token';
    vi.stubGlobal('fetch', upstream);
    const app = new Hono<ApiEnvironment>();
    app.use('*', async (c, next) => {
      c.set('browserUserId', 'user-session');
      await next();
    });
    registerBrowserContextRoutes(app, config());
    const response = await app.request('/api/context/files', {
      headers: { 'x-agent-server-user-id': 'attacker' },
    });
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });
});
