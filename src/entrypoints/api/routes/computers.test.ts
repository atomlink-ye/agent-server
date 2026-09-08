import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { ComputerRepository } from '../../../application/ports/computer-repository.js';
import type { Computer } from '../../../domain/runtime/computer.js';
import {
  ComputerResponseSchema,
  ListComputersResponseSchema,
} from '../../../contracts/computers.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { registerComputerRoutes } from './computers.js';

const token = 'computer-api-token';
const tenantId = 'tenant_computer_api';
const workspaceId = '92000000-0000-4000-8000-000000000102';
const otherWorkspaceId = '92000000-0000-4000-8000-000000000999';
const principalId = 'svc_computer_api';

describe('Computer API surface', () => {
  it('authenticates, creates, and lists Computers scoped to the caller workspace', async () => {
    const store = new Map<string, Computer>();
    const app = new Hono<ApiEnvironment>();
    registerComputerRoutes(app, {
      config: config(),
      computerRepository: fakeRepository(store),
      now: () => new Date('2026-09-08T10:00:00.000Z'),
    });

    const denied = await app.request('/api/v1/computers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'cloud', name: 'Primary Cloud' }),
    });
    expect(denied.status).toBe(401);

    const created = await app.request('/api/v1/computers', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ kind: 'cloud', name: 'Primary Cloud' }),
    });
    expect(created.status).toBe(201);
    const createdBody = ComputerResponseSchema.parse(await created.json());
    expect(createdBody.kind).toBe('cloud');
    expect(createdBody.status).toBe('offline');

    // The assertion of record: the row actually landed in storage under the
    // caller's tenant/workspace, not just echoed back in the response body.
    const stored = store.get(createdBody.id);
    expect(stored).toMatchObject({
      id: createdBody.id,
      tenantId,
      workspaceId,
      kind: 'cloud',
      name: 'Primary Cloud',
      status: 'offline',
    });

    const listed = await app.request('/api/v1/computers', {
      method: 'GET',
      headers: headers(),
    });
    expect(listed.status).toBe(200);
    const listedBody = ListComputersResponseSchema.parse(await listed.json());
    expect(listedBody.items.map((item) => item.id)).toEqual([createdBody.id]);
  });

  it('never lists a Computer created under a different workspace', async () => {
    const store = new Map<string, Computer>();
    store.set('computer-foreign', {
      id: 'computer-foreign',
      tenantId,
      workspaceId: otherWorkspaceId,
      kind: 'local',
      name: 'Someone Else’s Machine',
      status: 'offline',
      createdAt: '2026-09-08T09:00:00.000Z',
      updatedAt: '2026-09-08T09:00:00.000Z',
    });
    const app = new Hono<ApiEnvironment>();
    registerComputerRoutes(app, {
      config: config(),
      computerRepository: fakeRepository(store),
    });

    const listed = await app.request('/api/v1/computers', {
      method: 'GET',
      headers: headers(),
    });
    const listedBody = ListComputersResponseSchema.parse(await listed.json());
    expect(listedBody.items).toEqual([]);
  });
});

function fakeRepository(store: Map<string, Computer>): ComputerRepository {
  return {
    create: async (computer) => {
      store.set(computer.id, computer);
      return computer;
    },
    findById: async (input) => {
      const found = store.get(input.id);
      return found &&
        found.tenantId === input.tenantId &&
        found.workspaceId === input.workspaceId
        ? found
        : null;
    },
    listByWorkspace: async (input) =>
      [...store.values()].filter(
        (computer) =>
          computer.tenantId === input.tenantId &&
          computer.workspaceId === input.workspaceId,
      ),
  };
}

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'computer-api-test',
    directChatPlane: 'execution_runtime',
    productWorkSurface: 'composed',
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '/tmp/computer-api-test',
    chat: { activationBurstDebounceMs: 2_000 },
    serviceAccounts: [
      {
        serviceAccountId: principalId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-computer-api',
        disabled: false,
      },
    ],
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      agentCwd: '/tmp/computer-api-test',
      provider: 'opencode',
      workspaceTitle: 'Computer API Test',
      connectTimeoutMs: 1000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 1000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 2000,
      sessionRpcTimeoutSource: 'default',
    },
  } as AppConfig;
}
