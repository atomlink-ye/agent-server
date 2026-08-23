import { describe, expect, it, vi } from 'vitest';

import {
  AgentDefinitionResponseSchema,
  AgentIdSchema,
  AgentVersionResponseSchema,
  AgentVersionListResponseSchema,
  ImportAgentResponseSchema,
  ValidateAgentPackageResponseSchema,
  type AgentVersionResponse,
} from '../../src/contracts/agents.js';
import { ErrorResponseSchema } from '../../src/contracts/http.js';
import {
  createTestApp,
  disabledServiceAccountToken,
  primaryServiceAccountToken,
  secondaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';

const source = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Contract Agent
spec:
  description: description
  instructions: instructions
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: hello
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 1
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;

const forbiddenResponseFields = [
  'package',
  'canonicalJson',
  'instructions',
  'prompt',
  'permissions',
  'owner_id',
  'tenant_id',
  'principal_id',
  'model',
  'token',
  source,
];

function headers(token = primaryServiceAccountToken, key?: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(key ? { 'idempotency-key': key } : {}),
  };
}

function headersWithRequestId(
  token = primaryServiceAccountToken,
  key?: string,
  requestId = 'req-agent',
) {
  return { ...headers(token, key), 'x-request-id': requestId };
}

function packageWith(overrides: string): string {
  return source.replace(
    '  description: description',
    `  description: ${overrides}`,
  );
}

function expectSafe(value: unknown, forbidden: string[]): void {
  const serialized = JSON.stringify(value);
  for (const field of forbidden) expect(serialized).not.toContain(field);
}

function validBodyAtBytes(target: number): string {
  let paddedSource = `${source}\n# `;
  while (Buffer.byteLength(JSON.stringify({ source: paddedSource })) < target)
    paddedSource +=
      target - Buffer.byteLength(JSON.stringify({ source: paddedSource })) >= 4
        ? '🙂'
        : ' ';
  return JSON.stringify({ source: paddedSource });
}

function splitBody(body: string): ReadableStream<Uint8Array> {
  const bytes = new Uint8Array(Buffer.from(body));
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += 3)
        controller.enqueue(bytes.slice(offset, offset + 3));
      controller.close();
    },
  });
}

function splitBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += 2)
        controller.enqueue(bytes.slice(offset, offset + 2));
      controller.close();
    },
  });
}

async function requestChunked(
  app: Awaited<ReturnType<typeof createTestApp>>,
  path: string,
  body: string,
  key: string | undefined,
  contentLength?: string,
): Promise<Response> {
  const request = new Request(`http://agent.test${path}`, {
    method: 'POST',
    headers: {
      ...headers(primaryServiceAccountToken, key),
      ...(contentLength ? { 'content-length': contentLength } : {}),
    },
    body: splitBody(body),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return app.fetch(request);
}

async function requestRawBytes(
  app: Awaited<ReturnType<typeof createTestApp>>,
  path: string,
  bytes: Uint8Array,
  key?: string,
  contentLength?: string,
): Promise<Response> {
  return app.fetch(
    new Request(`http://agent.test${path}`, {
      method: 'POST',
      headers: {
        ...headers(primaryServiceAccountToken, key),
        ...(contentLength ? { 'content-length': contentLength } : {}),
      },
      body: splitBytes(bytes),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }),
  );
}

async function importedApp() {
  const app = await createTestApp(new FakeAgentRuntime(), {
    startDispatcher: false,
  });
  const response = await app.request('/api/v1/agents:import', {
    method: 'POST',
    headers: headers(primaryServiceAccountToken, 'import-1'),
    body: JSON.stringify({ source }),
  });
  expect(response.status).toBe(201);
  return { app, body: ImportAgentResponseSchema.parse(await response.json()) };
}

describe('managed agent HTTP contracts', () => {
  it.each([
    {},
    { authorization: 'Basic nope' },
    { authorization: 'Bearer unknown' },
    { authorization: `Bearer ${disabledServiceAccountToken}` },
  ])('returns stable authentication failure', async (auth) => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const response = await app.request('/api/v1/agent-packages:validate', {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': 'application/json',
        'x-request-id': 'req-auth',
      },
      body: JSON.stringify({ source }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(
      ErrorResponseSchema.parse(await response.json()).error.request_id,
    ).toBe('req-auth');
  });

  it('validates with the exact safe response and rejects malformed input', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const valid = await app.request('/api/v1/agent-packages:validate', {
      method: 'POST',
      headers: headersWithRequestId(),
      body: JSON.stringify({ source }),
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get('x-request-id')).toBe('req-agent');
    const body = ValidateAgentPackageResponseSchema.parse(await valid.json());
    expectSafe(body, forbiddenResponseFields);
    expect(body).toEqual({
      valid: true,
      fingerprint: expect.stringMatching(/^sha256:/),
      metadata: { normalized_name: 'contract-agent' },
      compiler: {
        pattern_dialect: expect.any(String),
        pattern_compiler_version: expect.any(String),
      },
    });
    for (const bad of [
      '{',
      JSON.stringify({ source, owner: 'x' }),
      JSON.stringify({ source: 'not a package' }),
    ]) {
      const response = await app.request('/api/v1/agent-packages:validate', {
        method: 'POST',
        headers: headers(),
        body: bad,
      });
      expect([400, 413]).toContain(response.status);
      expect(
        ErrorResponseSchema.parse(await response.json()).error.code,
      ).toMatch(/invalid_json|invalid_request|invalid_agent_package/);
    }
  });

  it('imports, replays, and conflicts idempotent requests without unsafe fields', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const first = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: headersWithRequestId(primaryServiceAccountToken, 'same'),
      body: JSON.stringify({ source }),
    });
    expect(first.headers.get('x-request-id')).toBe('req-agent');
    const replay = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: headers(primaryServiceAccountToken, 'same'),
      body: JSON.stringify({ source }),
    });
    const conflict = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: headers(primaryServiceAccountToken, 'same'),
      body: JSON.stringify({
        source: source.replace('Contract Agent', 'Other Agent'),
      }),
    });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(conflict.status).toBe(409);
    const firstBody = ImportAgentResponseSchema.parse(await first.json());
    const replayBody = ImportAgentResponseSchema.parse(await replay.json());
    expect(replayBody.result).toBe('replayed');
    expectSafe(firstBody, forbiddenResponseFields);
    expectSafe(replayBody, forbiddenResponseFields);
    expect(ErrorResponseSchema.parse(await conflict.json()).error.code).toBe(
      'idempotency_conflict',
    );
  });

  it('reads, lists, publishes, and allows same-tenant reads', async () => {
    const { app, body } = await importedApp();
    const definition = AgentDefinitionResponseSchema.parse(
      await (
        await app.request(`/api/v1/agents/${body.agent.id}`, {
          headers: headers(),
        })
      ).json(),
    );
    expect(definition.id).toBe(body.agent.id);
    expectSafe(definition, forbiddenResponseFields);
    const version = AgentVersionResponseSchema.parse(
      await (
        await app.request(`/api/v1/agent-versions/${body.version.id}`, {
          headers: headers(),
        })
      ).json(),
    );
    expect(version.id).toBe(body.version.id);
    expectSafe(version, forbiddenResponseFields);
    const list = AgentVersionListResponseSchema.parse(
      await (
        await app.request(`/api/v1/agents/${body.agent.id}/versions?limit=1`, {
          headers: headers(),
        })
      ).json(),
    );
    expect(list.items.map((item) => item.id)).toEqual([body.version.id]);
    expectSafe(list, forbiddenResponseFields);
    const published = await app.request(
      `/api/v1/agent-versions/${body.version.id}:publish`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'pub'),
        body: '{}',
      },
    );
    expect(published.status).toBe(200);
    const publishedBody = AgentVersionResponseSchema.parse(
      await published.json(),
    );
    expect(publishedBody.status).toBe('published');
    expectSafe(publishedBody, forbiddenResponseFields);
    const foreign = await app.request(`/api/v1/agents/${body.agent.id}`, {
      headers: headers(secondaryServiceAccountToken),
    });
    expect(foreign.status).toBe(200);
    const foreignDef = AgentDefinitionResponseSchema.parse(
      await foreign.json(),
    );
    expect(foreignDef.id).toBe(body.agent.id);
    expectSafe(foreignDef, forbiddenResponseFields);
  });

  it('requires idempotency keys for mutation routes', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const response = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ source }),
    });
    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'invalid_idempotency_key',
    );
  });

  it('exposes exactly the managed Agent route inventory in its namespace', async () => {
    const { app, body } = await importedApp();
    const routes = [
      ['POST', '/api/v1/agent-packages:validate', 200, { source }],
      ['POST', '/api/v1/agents:import', 201, { source }],
      ['GET', '/api/v1/agents', 200],
      ['GET', `/api/v1/agents/${body.agent.id}`, 200],
      ['GET', `/api/v1/agents/${body.agent.id}/versions`, 200],
      ['GET', `/api/v1/agent-versions/${body.version.id}`, 200],
      ['POST', `/api/v1/agent-versions/${body.version.id}:publish`, 200, {}],
    ] as const;
    for (const [method, path, expected, requestBody] of routes) {
      const response = await app.request(path, {
        method,
        headers: headers(
          'token-enabled',
          method === 'POST' && path.includes('import')
            ? 'inventory'
            : 'inventory-publish',
        ),
        ...(requestBody === undefined
          ? {}
          : { body: JSON.stringify(requestBody) }),
      });
      expect(response.status).toBe(expected);
      if (path === '/api/v1/agent-packages:validate')
        expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    }
    const variants = [
      ['GET', '/api/v1/agent-package:validate'],
      ['POST', '/api/v1/agents/'],
      ['GET', `/api/v1/agent/${body.agent.id}`],
      ['POST', `/api/v1/agents/${body.agent.id}`],
      ['GET', `/api/v1/agents/${body.agent.id}/version`],
      ['POST', `/api/v1/agent-versions/${body.version.id}/publish`],
    ] as const;
    for (const [method, path] of variants) {
      const response = await app.request(path, { method, headers: headers() });
      expect([404, 405]).toContain(response.status);
    }
  });

  // DECISION-011 family B: independent master evidence in e9d8dd3f has
  // src/entrypoints/api/routes/agent-profile.ts, and
  // create-resource-capabilities.ts
  // imports/registers it in installHttp; this fixes an incomplete test-only
  // graph rather than expanding the contract.
  it('exposes exactly the eight approved managed Agent routes', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const actual = app.routes
      .filter(
        (route) =>
          route.path.startsWith('/api/v1/agent') && route.method !== 'ALL',
      )
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(actual).toEqual(
      [
        'GET /api/v1/agent-versions/:versionId',
        'GET /api/v1/agents',
        'GET /api/v1/agents/:agentId',
        'GET /api/v1/agents/:agentId/versions',
        'GET /api/v1/agents/:agentId/profile',
        'POST /api/v1/agent-packages:validate',
        'POST /api/v1/agent-versions/:versionId:publish',
        'POST /api/v1/agents:import',
      ].sort(),
    );
  });

  it('rejects noncanonical UUID path parameters before application calls', async () => {
    const { app, body } = await importedApp();
    const invalid = '00000000-0000-4000-8000-00000000000Z';
    const requests = [
      app.request(`/api/v1/agents/${invalid}`, { headers: headers() }),
      app.request(`/api/v1/agents/${invalid}/versions`, {
        headers: headers(),
      }),
      app.request(`/api/v1/agent-versions/${invalid}`, {
        headers: headers(),
      }),
      app.request(`/api/v1/agent-versions/${invalid}:publish`, {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'invalid-path'),
        body: '{}',
      }),
    ];
    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(await response.json());
      expect(error.error.code).toBe('invalid_request');
      expect(JSON.stringify(error)).not.toContain(invalid);
    }
    const publishAfterInvalidPath = await app.request(
      `/api/v1/agent-versions/${body.version.id}:publish`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'invalid-path'),
        body: '{}',
      },
    );
    expect(publishAfterInvalidPath.status).toBe(200);
  });

  it('enforces the UTF-8 body boundary independently of Content-Length', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const exact = validBodyAtBytes(64 * 1024);
    const over = `${exact} `;
    expect(Buffer.byteLength(exact)).toBe(64 * 1024);
    expect(Buffer.byteLength(over)).toBe(64 * 1024 + 1);
    const unboundedRead = vi
      .spyOn(Request.prototype, 'arrayBuffer')
      .mockImplementation(() => {
        throw new Error('unbounded body read');
      });

    try {
      for (const path of [
        '/api/v1/agent-packages:validate',
        '/api/v1/agents:import',
      ]) {
        const key = path.endsWith(':import') ? 'multibyte-exact' : undefined;
        for (const contentLength of [undefined, '1']) {
          const accepted = await requestChunked(
            app,
            path,
            exact,
            key ? `${key}-${contentLength ?? 'missing'}` : undefined,
            contentLength,
          );
          expect(accepted.status).toBe(path.endsWith(':import') ? 201 : 200);
          const acceptedBody = await accepted.json();
          if (path.endsWith(':import'))
            expectSafe(
              ImportAgentResponseSchema.parse(acceptedBody),
              forbiddenResponseFields,
            );
          else
            expectSafe(
              ValidateAgentPackageResponseSchema.parse(acceptedBody),
              forbiddenResponseFields,
            );

          const rejected = await requestChunked(
            app,
            path,
            over,
            key ? `${key}-over-${contentLength ?? 'missing'}` : undefined,
            contentLength,
          );
          expect(rejected.status).toBe(413);
          const error = ErrorResponseSchema.parse(await rejected.json());
          expect(error.error.code).toBe('request_too_large');
          expectSafe(error, [source, '🙂']);
        }
      }
    } finally {
      unboundedRead.mockRestore();
    }
  }, 30_000);

  it('maps invalid UTF-8 bytes to invalid_json without replacement or echo', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const bytes = new Uint8Array(
      Buffer.concat([
        Buffer.from('{"source":"'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from('"}'),
      ]),
    );
    for (const path of [
      '/api/v1/agent-packages:validate',
      '/api/v1/agents:import',
    ]) {
      const response = await requestRawBytes(
        app,
        path,
        bytes,
        path.endsWith(':import') ? 'invalid-utf8' : undefined,
        '1',
      );
      expect(response.status).toBe(400);
      const error = ErrorResponseSchema.parse(await response.json());
      expect(error.error.code).toBe('invalid_json');
      expect(JSON.stringify(error)).not.toContain('\ufffd');
      expect(JSON.stringify(error)).not.toContain('source');
    }
  });

  it('applies mutation key validation and publish replay/conflict semantics', async () => {
    const { app, body } = await importedApp();
    for (const key of ['', ' '.repeat(2), 'x'.repeat(256)]) {
      const response = await app.request('/api/v1/agents:import', {
        method: 'POST',
        headers: { ...headers(), 'idempotency-key': key },
        body: JSON.stringify({ source }),
      });
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
        'invalid_idempotency_key',
      );
    }
    for (const key of ['', ' '.repeat(2), 'x'.repeat(256)]) {
      const response = await app.request(
        `/api/v1/agent-versions/${body.version.id}:publish`,
        {
          method: 'POST',
          headers: { ...headers(), 'idempotency-key': key },
          body: '{}',
        },
      );
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
        'invalid_idempotency_key',
      );
    }
    const first = await app.request(
      `/api/v1/agent-versions/${body.version.id}:publish`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'publish-replay'),
        body: '{}',
      },
    );
    const replay = await app.request(
      `/api/v1/agent-versions/${body.version.id}:publish`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'publish-replay'),
        body: '{}',
      },
    );
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await first.clone().json()).toEqual(await replay.json());
    const second = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: headers(primaryServiceAccountToken, 'second-import'),
      body: JSON.stringify({ source: packageWith('second') }),
    });
    const secondBody = ImportAgentResponseSchema.parse(await second.json());
    const conflict = await app.request(
      `/api/v1/agent-versions/${secondBody.version.id}:publish`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'publish-replay'),
        body: '{}',
      },
    );
    expect(conflict.status).toBe(409);
    expect(ErrorResponseSchema.parse(await conflict.json()).error.code).toBe(
      'idempotency_conflict',
    );
  });

  it('allows same-tenant reads but still rejects a foreign publish', async () => {
    const { app, body } = await importedApp();

    // Publish the version first so reads are against a published state
    const published = await app.request(
      `/api/v1/agent-versions/${body.version.id}:publish`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'pub-first'),
        body: '{}',
      },
    );
    expect(published.status).toBe(200);

    // Read requests from secondary principal should succeed (200)
    const readDefinition = await app.request(
      `/api/v1/agents/${body.agent.id}`,
      {
        headers: headersWithRequestId(
          secondaryServiceAccountToken,
          undefined,
          'read-def',
        ),
      },
    );
    expect(readDefinition.status).toBe(200);
    const defResponse = AgentDefinitionResponseSchema.parse(
      await readDefinition.json(),
    );
    expect(defResponse.id).toBe(body.agent.id);
    expectSafe(defResponse, forbiddenResponseFields);

    const readVersion = await app.request(
      `/api/v1/agent-versions/${body.version.id}`,
      {
        headers: headersWithRequestId(
          secondaryServiceAccountToken,
          undefined,
          'read-ver',
        ),
      },
    );
    expect(readVersion.status).toBe(200);
    const verResponse = AgentVersionResponseSchema.parse(
      await readVersion.json(),
    );
    expect(verResponse.id).toBe(body.version.id);
    expectSafe(verResponse, forbiddenResponseFields);

    const readVersions = await app.request(
      `/api/v1/agents/${body.agent.id}/versions`,
      {
        headers: headersWithRequestId(
          secondaryServiceAccountToken,
          undefined,
          'read-vers',
        ),
      },
    );
    expect(readVersions.status).toBe(200);
    const versResponse = AgentVersionListResponseSchema.parse(
      await readVersions.json(),
    );
    expect(versResponse.items.map((item) => item.id)).toContain(
      body.version.id,
    );
    expectSafe(versResponse, forbiddenResponseFields);

    // Write operation (publish) from secondary principal should still fail (404)
    const publishAttempt = await app.request(
      `/api/v1/agent-versions/${body.version.id}:publish`,
      {
        method: 'POST',
        headers: headersWithRequestId(
          secondaryServiceAccountToken,
          'foreign-publish',
          'write-op',
        ),
        body: '{}',
      },
    );
    expect(publishAttempt.status).toBe(404);
    const publishError = ErrorResponseSchema.parse(await publishAttempt.json());
    expect(publishError.error.code).toBe('agent_not_found');
    expectSafe(publishError, forbiddenResponseFields);
  });

  it('paginates Agent versions in repository order without duplicates', async () => {
    const { app, body } = await importedApp();
    const ids = [body.version.id];
    for (let index = 1; index < 5; index += 1) {
      const response = await app.request('/api/v1/agents:import', {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, `page-${index}`),
        body: JSON.stringify({ source: packageWith(`description-${index}`) }),
      });
      ids.push(
        ImportAgentResponseSchema.parse(await response.json()).version.id,
      );
    }
    const seen: string[] = [];
    const cursors: string[] = [];
    let previous: AgentVersionResponse | undefined;
    let cursor: string | null = null;
    for (;;) {
      const response = await app.request(
        `/api/v1/agents/${body.agent.id}/versions?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { headers: headers() },
      );
      const page = AgentVersionListResponseSchema.parse(await response.json());
      expectSafe(page, forbiddenResponseFields);
      for (const item of page.items) {
        if (previous)
          expect(
            [previous.created_at, previous.id].join('\0') <
              [item.created_at, item.id].join('\0'),
          ).toBe(true);
        previous = item;
      }
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      if (cursor) cursors.push(cursor);
      if (!cursor) break;
    }
    expect(seen).toHaveLength(ids.length);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(new Set(seen).size).toBe(ids.length);
    expect(cursor).toBeNull();
    expect(cursors.length).toBeGreaterThan(0);
    expect(new Set(cursors).size).toBe(cursors.length);
    for (const query of ['0', '-1', '101', 'nope']) {
      const response = await app.request(
        `/api/v1/agents/${body.agent.id}/versions?limit=${query}`,
        { headers: headers() },
      );
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
        'invalid_limit',
      );
    }
    const malformedCursor = await app.request(
      `/api/v1/agents/${body.agent.id}/versions?cursor=bad`,
      { headers: headers() },
    );
    expect(malformedCursor.status).toBe(400);
    expect(
      ErrorResponseSchema.parse(await malformedCursor.json()).error.code,
    ).toBe('invalid_cursor');
  });

  it('parses version-list queries strictly and rejects ambiguity before lookup', async () => {
    const { app, body } = await importedApp();
    const second = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: headers(primaryServiceAccountToken, 'query-second'),
      body: JSON.stringify({ source: packageWith('query-second') }),
    });
    expect(second.status).toBe(201);
    const validCursorPage = AgentVersionListResponseSchema.parse(
      await (
        await app.request(`/api/v1/agents/${body.agent.id}/versions?limit=1`, {
          headers: headers(),
        })
      ).json(),
    );
    expect(validCursorPage.next_cursor).toEqual(expect.any(String));
    const missingAgentId = '00000000-0000-4000-8000-00000000ffff';

    for (const query of [
      'unknown=value',
      'limit=1&limit=2',
      'cursor=bad&cursor=also-bad',
    ]) {
      const response = await app.request(
        `/api/v1/agents/${missingAgentId}/versions?${query}`,
        { headers: headers() },
      );
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
        'invalid_request',
      );
    }

    for (const value of [
      '01',
      '1e1',
      '+1',
      '1.0',
      ' 1',
      '1 ',
      '',
      '0',
      '-1',
      '101',
      'Infinity',
      'NaN',
      '0x10',
    ]) {
      const response = await app.request(
        `/api/v1/agents/${missingAgentId}/versions?limit=${encodeURIComponent(value)}`,
        { headers: headers() },
      );
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
        'invalid_limit',
      );
    }

    const emptyCursor = await app.request(
      `/api/v1/agents/${missingAgentId}/versions?cursor=`,
      { headers: headers() },
    );
    expect(emptyCursor.status).toBe(400);
    expect(ErrorResponseSchema.parse(await emptyCursor.json()).error.code).toBe(
      'invalid_cursor',
    );

    const valid = await app.request(
      `/api/v1/agents/${body.agent.id}/versions?limit=1&cursor=${encodeURIComponent(validCursorPage.next_cursor!)}`,
      { headers: headers() },
    );
    expect(valid.status).toBe(200);
    AgentVersionListResponseSchema.parse(await valid.json());
  });

  it('rejects caller ownership fields and concrete model injection, and propagates request IDs', async () => {
    const app = await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
    });
    const forbidden = ['tenant', 'principal', 'workspace', 'owner', 'model'];
    for (const route of [
      '/api/v1/agent-packages:validate',
      '/api/v1/agents:import',
    ]) {
      const response = await app.request(route, {
        method: 'POST',
        headers: headersWithRequestId(
          primaryServiceAccountToken,
          route.includes('import') ? 'strict-key' : undefined,
          'strict-id',
        ),
        body: JSON.stringify({
          source,
          tenant_id: 'other',
          principal_id: 'other',
          workspace_id: 'other',
          owner: 'other',
          model: 'paid/model',
        }),
      });
      expect(response.status).toBe(400);
      expect(response.headers.get('x-request-id')).toBe('strict-id');
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
        'invalid_request',
      );
    }
    const modelInjected = source.replace(
      'modelPolicyRef: free-only',
      'modelPolicyRef: paid/model',
    );
    const response = await app.request('/api/v1/agent-packages:validate', {
      method: 'POST',
      headers: headersWithRequestId(),
      body: JSON.stringify({ source: modelInjected }),
    });
    expect(response.status).toBe(400);
    const error = ErrorResponseSchema.parse(await response.json());
    expect(error.error.code).toBe('invalid_agent_package');
    expectSafe(error, forbidden);
    const invalidImport = await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: headers(primaryServiceAccountToken, 'paid-model-import'),
      body: JSON.stringify({ source: modelInjected }),
    });
    expect(invalidImport.status).toBe(400);
    const invalidImportError = ErrorResponseSchema.parse(
      await invalidImport.json(),
    );
    expect(invalidImportError.error.code).toBe('invalid_agent_package');
    expectSafe(invalidImportError, [...forbidden, source, 'paid/model']);
    const validAfterRejectedImport = await app.request(
      '/api/v1/agents:import',
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'paid-model-import'),
        body: JSON.stringify({ source }),
      },
    );
    expect(validAfterRejectedImport.status).toBe(201);
    const createdAfterRejectedImport = ImportAgentResponseSchema.parse(
      await validAfterRejectedImport.json(),
    );
    expectSafe(createdAfterRejectedImport, forbiddenResponseFields);
    const imported = await importedApp();
    for (const request of [
      imported.app.request(`/api/v1/agents/${imported.body.agent.id}`, {
        headers: headersWithRequestId(),
      }),
      imported.app.request(
        `/api/v1/agents/${imported.body.agent.id}/versions`,
        { headers: headersWithRequestId() },
      ),
      imported.app.request(
        `/api/v1/agent-versions/${imported.body.version.id}`,
        { headers: headersWithRequestId() },
      ),
    ])
      expect((await request).headers.get('x-request-id')).toBe('req-agent');
    const publish = await imported.app.request(
      `/api/v1/agent-versions/${imported.body.version.id}:publish`,
      {
        method: 'POST',
        headers: headersWithRequestId(
          primaryServiceAccountToken,
          'request-publish',
        ),
        body: '{}',
      },
    );
    expect(publish.headers.get('x-request-id')).toBe('req-agent');
  });

  it('keeps public Agent schemas strict and resource-shaped', async () => {
    const { body } = await importedApp();
    expect(() => AgentIdSchema.parse('not-a-uuid')).toThrow();
    expect(() =>
      AgentDefinitionResponseSchema.parse({
        ...body.agent,
        id: 'not-a-uuid',
      }),
    ).toThrow();
    expect(() =>
      AgentVersionResponseSchema.parse({
        ...body.version,
        fingerprint: 'sha256:BAD',
      }),
    ).toThrow();
    expect(() =>
      AgentVersionResponseSchema.parse({
        ...body.version,
        updated_at: 'yesterday',
      }),
    ).toThrow();
    expect(() =>
      AgentDefinitionResponseSchema.parse({
        ...body.agent,
        links: { ...body.agent.links, self: 'https://evil.test/agent' },
      }),
    ).toThrow();
    expect(() =>
      AgentVersionResponseSchema.parse({
        ...body.version,
        compiler: {
          pattern_dialect: 'custom',
          pattern_compiler_version: 'unknown',
        },
      }),
    ).toThrow();
  });
});
