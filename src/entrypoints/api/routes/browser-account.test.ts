import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { registerBrowserAccountRoutes } from './browser-account.js';

const SERVICE_TOKEN = 'browser-service-secret';
const USER_ID = 'user-maya-hirer';

function testConfig(): AppConfig {
  return {
    port: 3000,
    serviceAccounts: [],
    productWorkSurface: 'composed',
  } as unknown as AppConfig;
}

function appWithAccountRoutes(): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  registerBrowserAccountRoutes(app, testConfig());
  return app;
}

function enableServiceAccount(): void {
  process.env.AGENT_SERVER_SERVICE_TOKEN = SERVICE_TOKEN;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_SERVER_SERVICE_TOKEN;
  delete process.env.AGENT_SERVER_BASE_URL;
});

describe('browser-safe Account facade', () => {
  it('reads the caller’s own account with only a human identifier header, no authorization header from the browser', async () => {
    enableServiceAccount();
    const upstream = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain('/api/v1/account');
        const headers = new Headers(init?.headers);
        // This is exactly what the BFF must add on the caller's behalf: a
        // real browser never has the service token, only the forwarded
        // human identifier below.
        expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`);
        expect(headers.get('x-agent-server-user-id')).toBe(USER_ID);
        return new Response(
          JSON.stringify({
            principal_id: USER_ID,
            principal_type: 'user',
            display_name: 'Maya',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', upstream);

    // Simulate a real browser request: only the human identifier header is
    // present, no authorization header at all.
    const response = await appWithAccountRoutes().request('/api/account', {
      headers: { 'x-agent-server-user-id': USER_ID },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      principal_id: USER_ID,
      principal_type: 'user',
      display_name: 'Maya',
    });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('renames the caller through the canonical account facade with only a human identifier header, no authorization header from the browser', async () => {
    enableServiceAccount();
    const upstream = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain('/api/v1/account/display-name');
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`);
        expect(headers.get('x-agent-server-user-id')).toBe(USER_ID);
        expect(JSON.parse(String(init?.body))).toEqual({
          display_name: 'Maya Rivera',
        });
        return new Response(JSON.stringify({ display_name: 'Maya Rivera' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', upstream);

    // Simulate a real browser request: only the human identifier header is
    // present, no authorization header at all -- this is the exact shape
    // that used to 401 before this BFF route existed.
    const response = await appWithAccountRoutes().request(
      '/api/account/display-name',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-agent-server-user-id': USER_ID,
        },
        body: JSON.stringify({ display_name: 'Maya Rivera' }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ display_name: 'Maya Rivera' });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('rejects an invalid display name before ever reaching the upstream service', async () => {
    enableServiceAccount();
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const response = await appWithAccountRoutes().request(
      '/api/account/display-name',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-agent-server-user-id': USER_ID,
        },
        body: JSON.stringify({ display_name: '' }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fails closed when no browser service credential is configured', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);

    const response = await appWithAccountRoutes().request('/api/account', {
      headers: { 'x-agent-server-user-id': USER_ID },
    });
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: 'service_unavailable' },
    });
  });
});
