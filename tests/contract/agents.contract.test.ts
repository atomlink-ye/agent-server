import { describe, expect, it } from 'vitest';

import {
  AgentDefinitionResponseSchema,
  AgentVersionResponseSchema,
  AgentVersionListResponseSchema,
  ImportAgentResponseSchema,
  ValidateAgentPackageResponseSchema,
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

function headers(token = primaryServiceAccountToken, key?: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(key ? { 'idempotency-key': key } : {}),
  };
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
      headers: headers(),
      body: JSON.stringify({ source }),
    });
    expect(valid.status).toBe(200);
    const body = ValidateAgentPackageResponseSchema.parse(await valid.json());
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
      headers: headers(primaryServiceAccountToken, 'same'),
      body: JSON.stringify({ source }),
    });
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
    expect(ImportAgentResponseSchema.parse(await replay.json()).result).toBe(
      'replayed',
    );
    expect(firstBody.agent).not.toHaveProperty('owner_id');
    expect(firstBody.version).not.toHaveProperty('package');
    expect(ErrorResponseSchema.parse(await conflict.json()).error.code).toBe(
      'idempotency_conflict',
    );
  });

  it('reads, lists, publishes, and hides foreign resources', async () => {
    const { app, body } = await importedApp();
    const definition = AgentDefinitionResponseSchema.parse(
      await (
        await app.request(`/api/v1/agents/${body.agent.id}`, {
          headers: headers(),
        })
      ).json(),
    );
    expect(definition.id).toBe(body.agent.id);
    const version = AgentVersionResponseSchema.parse(
      await (
        await app.request(`/api/v1/agent-versions/${body.version.id}`, {
          headers: headers(),
        })
      ).json(),
    );
    expect(version.id).toBe(body.version.id);
    const list = AgentVersionListResponseSchema.parse(
      await (
        await app.request(`/api/v1/agents/${body.agent.id}/versions?limit=1`, {
          headers: headers(),
        })
      ).json(),
    );
    expect(list.items.map((item) => item.id)).toEqual([body.version.id]);
    const published = await app.request(
      `/api/v1/agent-versions/${body.version.id}:publish`,
      {
        method: 'POST',
        headers: headers(primaryServiceAccountToken, 'pub'),
        body: '{}',
      },
    );
    expect(published.status).toBe(200);
    expect(
      AgentVersionResponseSchema.parse(await published.json()).status,
    ).toBe('published');
    const foreign = await app.request(`/api/v1/agents/${body.agent.id}`, {
      headers: headers(secondaryServiceAccountToken),
    });
    expect(foreign.status).toBe(404);
    expect(ErrorResponseSchema.parse(await foreign.json()).error.code).toBe(
      'agent_not_found',
    );
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
});
