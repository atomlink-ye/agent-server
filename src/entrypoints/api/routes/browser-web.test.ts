import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import type { Logger } from '../../../shared/observability/logger.js';
import { registerBrowserWebRoutes } from './browser-web.js';

const SERVICE_TOKEN = 'browser-service-secret';
const WORK_ID = '11111111-1111-4111-8111-111111111111';

function testConfig(): AppConfig {
  return {
    port: 3000,
    serviceAccounts: [],
  } as unknown as AppConfig;
}

function fakeLogger(): Logger {
  return { log: () => undefined };
}

function appWithBrowserRoutes(
  logger: Logger = fakeLogger(),
): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  registerBrowserWebRoutes(app, testConfig(), logger);
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_SERVER_SERVICE_TOKEN;
  delete process.env.AGENT_SERVER_BASE_URL;
});

describe('browser-safe Vite facade', () => {
  it('uses the server-side service credential and strips unknown conversation fields', async () => {
    process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
    const upstream = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('authorization')).toBe(
          `Bearer ${SERVICE_TOKEN}`,
        );
        return new Response(
          JSON.stringify({
            conversations: [
              {
                conversation_id: 'conversation-1',
                kind: 'direct',
                title: null,
                direct_agent: {
                  agent_definition_id: 'agent-1',
                  display_name: 'Researcher',
                },
                topic: null,
                created_at: '2026-08-21T00:00:00.000Z',
                updated_at: '2026-08-21T00:00:00.000Z',
                provider_session: 'must-not-reach-browser',
              },
            ],
            service_token: SERVICE_TOKEN,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', upstream);

    const response = await appWithBrowserRoutes().request('/api/conversations');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({
      conversations: [
        {
          conversation_id: 'conversation-1',
          kind: 'direct',
          title: null,
          direct_agent: {
            agent_definition_id: 'agent-1',
            display_name: 'Researcher',
          },
          topic: null,
          created_at: '2026-08-21T00:00:00.000Z',
          updated_at: '2026-08-21T00:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(SERVICE_TOKEN);
    expect(JSON.stringify(body)).not.toContain('provider_session');
  });

  it('keeps the Work chat card bounded to browser-safe fields', async () => {
    process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              workId: WORK_ID,
              workRef: WORK_ID,
              title: 'Competitor Research',
              productState: 'running',
              problemKind: null,
              attentionReason: null,
              resultSummary: null,
              resultCaptureStatus: 'not_present',
              taskId: 'internal-task',
              runId: 'internal-run',
              provider_session: 'internal-provider-session',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const response = await appWithBrowserRoutes().request(
      `/api/works/${WORK_ID}/chat-card`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      workId: WORK_ID,
      workRef: WORK_ID,
      title: 'Competitor Research',
      productState: 'running',
      problemKind: null,
      attentionReason: null,
      resultSummary: null,
      resultCaptureStatus: 'not_present',
    });
    expect(JSON.stringify(body)).not.toMatch(/taskId|runId|provider_session/u);
  });

  it('rejects malformed Work identifiers without contacting the authenticated upstream', async () => {
    process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const response = await appWithBrowserRoutes().request(
      '/api/works/not-a-uuid',
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fails closed when no server-side browser credential is configured', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const response = await appWithBrowserRoutes().request('/api/conversations');
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: 'product_unavailable' },
    });
  });

  it('reports the real cause -- not invalid_response -- when the upstream declares a body over the BFF cap', async () => {
    process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
    const logger: Logger = { log: vi.fn() };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', {
            status: 200,
            headers: {
              'content-type': 'application/json',
              // Declares more than the 1 MiB the BFF will forward, so the
              // gateway must reject on the header alone without buffering.
              'content-length': String(1024 * 1024 + 1),
            },
          }),
      ),
    );

    const response =
      await appWithBrowserRoutes(logger).request('/api/conversations');

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: 'upstream_response_too_large' },
    });
    expect(body.error.code).not.toBe('invalid_response');
    expect(logger.log).toHaveBeenCalledWith(
      'warn',
      'browser_bff.upstream_response_too_large',
      expect.objectContaining({
        path: '/api/v1/conversations',
        declared_bytes: 1024 * 1024 + 1,
      }),
    );
  });

  it('still returns invalid_response when the upstream body genuinely does not decode', async () => {
    process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('not valid json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const response = await appWithBrowserRoutes().request('/api/conversations');

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: 'invalid_response' } });
    expect(body.error.code).not.toBe('upstream_response_too_large');
  });
});
