import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { WorkerRegistry } from '../../../application/ports/worker-registry.js';
import { ImportWorkerResponseSchema } from '../../../contracts/workers.js';
import type { WorkerDefinition } from '../../../domain/workers/worker-definition.js';
import type { WorkerVersion } from '../../../domain/workers/worker-version.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { registerWorkerRoutes } from './workers.js';

const token = 'worker-api-token';
const tenantId = 'tenant_worker_api';
const workspaceId = '91000000-0000-4000-8000-000000000102';
const principalId = 'svc_worker_api';
const definitionId = '91000000-0000-4000-8000-000000000201';
const versionId = '91000000-0000-4000-8000-000000000202';

describe('formal Worker API lifecycle', () => {
  it('authenticates, imports, and publishes a Worker without exposing a Coworker route', async () => {
    const commands: unknown[] = [];
    const app = new Hono<ApiEnvironment>();
    registerWorkerRoutes(app, {
      config: config(),
      workerRegistry: registry(commands),
    });

    const denied = await app.request('/api/v1/workers:import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: source() }),
    });
    expect(denied.status).toBe(401);

    const validation = await app.request('/api/v1/worker-packages:validate', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ source: source() }),
    });
    expect(validation.status).toBe(200);

    const imported = await app.request('/api/v1/workers:import', {
      method: 'POST',
      headers: headers('worker-import'),
      body: JSON.stringify({ source: source() }),
    });
    expect(imported.status).toBe(201);
    const body = ImportWorkerResponseSchema.parse(await imported.json());

    const published = await app.request(
      `/api/v1/worker-versions/${body.version.id}:publish`,
      { method: 'POST', headers: headers('worker-publish'), body: '{}' },
    );
    expect(published.status).toBe(200);
    expect((await published.json()).status).toBe('published');
    expect(commands).toMatchObject([
      { owner: { tenantId, workspaceId, principalId } },
      { owner: { tenantId, workspaceId, principalId }, versionId },
    ]);
    expect(app.routes.map((route) => route.path)).not.toContain(
      '/api/v1/agents',
    );
  });
});

function registry(commands: unknown[]): WorkerRegistry {
  const draft = version('draft');
  return {
    importWorker: async (command) => {
      commands.push(command);
      return { kind: 'created', definition: definition(), version: draft };
    },
    publishWorkerVersion: async (command) => {
      commands.push(command);
      return version('published');
    },
    findDefinition: async () => null,
    findVersion: async () => null,
  };
}

function headers(idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'worker-api-test',
    directChatPlane: 'execution_runtime',
    productWorkSurface: 'composed',
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '/tmp/worker-api-test',
    chat: { activationBurstDebounceMs: 2_000 },
    serviceAccounts: [
      {
        serviceAccountId: principalId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-worker-api',
        disabled: false,
      },
    ],
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      agentCwd: '/tmp/worker-api-test',
      provider: 'opencode',
      workspaceTitle: 'Worker API Test',
      connectTimeoutMs: 1000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 1000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 2000,
      sessionRpcTimeoutSource: 'default',
    },
  } as AppConfig;
}

function definition(): WorkerDefinition {
  return {
    id: definitionId,
    tenantId,
    workspaceId,
    principalType: 'service_account' as const,
    principalId,
    normalizedName: 'api-worker',
    displayName: 'API Worker',
    description: 'Formal execution Worker',
    createdAt: '2026-08-25T10:00:00.000Z',
    updatedAt: '2026-08-25T10:00:00.000Z',
  };
}

function version(status: 'draft' | 'published'): WorkerVersion {
  return {
    ...definition(),
    id: versionId,
    definitionId,
    status,
    package: {} as any,
    canonicalJson: '{}',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    compiler: { patternDialect: 're2', patternCompilerVersion: 're2js-2.8.6' },
    publishedAt: status === 'published' ? '2026-08-25T10:01:00.000Z' : null,
  };
}

function source(): string {
  return `apiVersion: agent-server/v1alpha1
kind: Worker
metadata: { name: API Worker }
spec:
  description: Formal execution worker
  instructions: Perform the assigned formal Work.
  runtime: { provider: paseo, modelPolicyRef: free-only, mode: isolated }
  tools: []
  skills: []
  input: { schema: { type: object, additionalProperties: false, properties: {} }, prompt: hello }
  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }
  memory: { policy: workspace_snapshot, proposalLimit: 1 }
  permissions: { network: none, filesystem: none }
  completion: { type: executable, command: done }
`;
}
