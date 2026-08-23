import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { registerBrowserCoworkerRoutes } from './browser-coworkers.js';

const SERVICE_TOKEN = 'browser-service-secret';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';

function testConfig(): AppConfig {
  return {
    port: 3000,
    serviceAccounts: [],
  } as unknown as AppConfig;
}

function appWithCoworkerRoutes(): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  registerBrowserCoworkerRoutes(app, testConfig());
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_SERVER_SERVICE_TOKEN;
  delete process.env.AGENT_SERVER_BASE_URL;
});

describe('browser-safe Coworker roster facade', () => {
  it('forwards the service credential and returns only the public Agent identity contract', async () => {
    process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
    const upstream = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain('/api/v1/agents?limit=100');
        expect(new Headers(init?.headers).get('authorization')).toBe(
          `Bearer ${SERVICE_TOKEN}`,
        );
        return new Response(
          JSON.stringify({
            items: [
              {
                id: AGENT_ID,
                normalized_name: 'research-analyst',
                display_name: 'Research Analyst',
                created_at: '2026-08-22T00:00:00.000Z',
                updated_at: '2026-08-22T00:00:00.000Z',
                role_label: 'Researcher',
                summary: 'Investigates markets and evidence.',
                links: {
                  self: `/api/v1/agents/${AGENT_ID}`,
                  versions: `/api/v1/agents/${AGENT_ID}/versions`,
                },
                active_agent_version_id: VERSION_ID,
                runtime_status: 'available',
                provider_session: 'must-not-reach-browser',
              },
            ],
            next_cursor: null,
            service_token: SERVICE_TOKEN,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', upstream);

    const response = await appWithCoworkerRoutes().request('/api/agents');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({
      items: [
        {
          id: AGENT_ID,
          normalized_name: 'research-analyst',
          display_name: 'Research Analyst',
          created_at: '2026-08-22T00:00:00.000Z',
          updated_at: '2026-08-22T00:00:00.000Z',
          role_label: 'Researcher',
          summary: 'Investigates markets and evidence.',
          links: {
            self: `/api/v1/agents/${AGENT_ID}`,
            versions: `/api/v1/agents/${AGENT_ID}/versions`,
          },
          active_agent_version_id: VERSION_ID,
          runtime_status: 'available',
        },
      ],
      next_cursor: null,
    });
    expect(JSON.stringify(body)).not.toContain(SERVICE_TOKEN);
    expect(JSON.stringify(body)).not.toContain('provider_session');
  });

  it('fails closed when no browser service credential is configured', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const response = await appWithCoworkerRoutes().request('/api/agents');
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: 'service_unavailable' },
    });
  });
});
