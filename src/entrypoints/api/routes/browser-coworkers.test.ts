import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { registerBrowserCoworkerRoutes } from './browser-coworkers.js';

const SERVICE_TOKEN = 'browser-service-secret';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const DEFINITION_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const CONVERSATION_ID = 'conversation-maya';

function testConfig(): AppConfig {
  return {
    port: 3000,
    serviceAccounts: [],
    productWorkAvailability: { surface: 'composed', execution: 'runtime' },
  } as unknown as AppConfig;
}

function appWithCoworkerRoutes(): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  registerBrowserCoworkerRoutes(app, testConfig());
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

describe('browser-safe Coworker facade', () => {
  it('forwards the service credential and returns only the public Agent identity contract', async () => {
    enableServiceAccount();
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
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: AGENT_ID,
      display_name: 'Research Analyst',
      role_label: 'Researcher',
      runtime_status: 'available',
    });
    expect(JSON.stringify(body)).not.toContain(SERVICE_TOKEN);
    expect(JSON.stringify(body)).not.toContain('provider_session');
  });

  it('creates a Coworker through the canonical authoring facade and keeps the idempotency key server-side', async () => {
    enableServiceAccount();
    const upstream = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain('/api/v1/coworkers');
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`);
        expect(headers.get('idempotency-key')).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          name: 'Maya',
          role: 'Research Analyst',
          summary: 'Research competitors.',
          model_policy_ref: 'free-only',
          tools: [],
          skills: [],
        });
        return new Response(
          JSON.stringify({
            agent_id: AGENT_ID,
            agent_version_id: VERSION_ID,
            conversation_id: CONVERSATION_ID,
            service_token: SERVICE_TOKEN,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', upstream);

    const response = await appWithCoworkerRoutes().request('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Maya',
        role: 'Research Analyst',
        summary: 'Research competitors.',
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      agent_id: AGENT_ID,
      agent_version_id: VERSION_ID,
      conversation_id: CONVERSATION_ID,
    });
  });

  it('projects the authoritative Work Catalog on the Coworker profile', async () => {
    enableServiceAccount();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              agent: {
                id: AGENT_ID,
                normalized_name: 'maya',
                display_name: 'Maya',
                created_at: '2026-08-22T00:00:00.000Z',
                updated_at: '2026-08-22T00:00:00.000Z',
                role_label: 'Research Analyst',
                summary: 'Research competitors.',
                links: {
                  self: `/api/v1/agents/${AGENT_ID}`,
                  versions: `/api/v1/agents/${AGENT_ID}/versions`,
                },
                active_agent_version_id: VERSION_ID,
                runtime_status: 'available',
              },
              capabilities: {
                model_policy_ref: 'free-only',
                proposal_limit: 0,
                tools: [],
                skills: [],
              },
              work_catalog: [
                {
                  definition_id: DEFINITION_ID,
                  definition_version_id: DEFINITION_VERSION_ID,
                  name: 'competitor-research',
                  description: 'Research competitors.',
                  input_schema: {
                    type: 'object',
                    properties: {
                      company: { type: 'string', min_length: 1 },
                    },
                    required: ['company'],
                    additional_properties: false,
                  },
                },
              ],
              provider_binding: 'must-not-reach-browser',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const response = await appWithCoworkerRoutes().request(
      `/api/agents/${AGENT_ID}/profile`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.work_catalog).toEqual([
      expect.objectContaining({
        definition_id: DEFINITION_ID,
        definition_version_id: DEFINITION_VERSION_ID,
        name: 'competitor-research',
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('provider_binding');
  });

  it('binds a Capability through the exact canonical Agent Work Catalog route', async () => {
    enableServiceAccount();
    const upstream = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain(
          `/api/v1/agents/${AGENT_ID}/capabilities`,
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          definition_id: DEFINITION_ID,
          definition_version_id: DEFINITION_VERSION_ID,
        });
        return new Response(
          JSON.stringify({
            associated: true,
            agent_definition_id: AGENT_ID,
            definition_id: DEFINITION_ID,
            definition_version_id: DEFINITION_VERSION_ID,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', upstream);

    const response = await appWithCoworkerRoutes().request(
      `/api/agents/${AGENT_ID}/capabilities`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          definition_id: DEFINITION_ID,
          definition_version_id: DEFINITION_VERSION_ID,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ associated: true });
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
