import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type {
  AgentRegistry,
  ImportAgentAtomicCommand,
  PublishAgentAtomicCommand,
} from '../../../application/ports/agent-registry.js';
import type { ComputerRepository } from '../../../application/ports/computer-repository.js';
import type { Computer } from '../../../domain/runtime/computer.js';
import type { AgentDefinition } from '../../../domain/agents/managed-agent-definition.js';
import type { ManagedAgentVersion } from '../../../domain/agents/managed-agent-version.js';
import { CreateCoworkerResponseSchema } from '../../../contracts/agents.js';
import { HttpError } from '../../../contracts/http.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { registerCoworkerAuthoringRoute } from './coworker-authoring.js';

const token = 'coworker-api-token';
const tenantId = 'tenant_coworker_api';
const workspaceId = '93000000-0000-4000-8000-000000000102';
const otherWorkspaceId = '93000000-0000-4000-8000-000000000999';
const principalId = 'svc_coworker_api';

describe('Coworker authoring — Computer binding', () => {
  it('persists the requested Computer onto the new Coworker definition', async () => {
    const definitions = new Map<string, AgentDefinition>();
    const computers = new Map<string, Computer>();
    const computerId = randomUUID();
    computers.set(computerId, {
      id: computerId,
      tenantId,
      workspaceId,
      kind: 'cloud',
      name: 'Bound Computer',
      status: 'offline',
      createdAt: '2026-09-08T09:00:00.000Z',
      updatedAt: '2026-09-08T09:00:00.000Z',
    });

    const app = buildApp();
    registerCoworkerAuthoringRoute(app, {
      config: config(),
      agentRegistry: fakeAgentRegistry(definitions),
      coworkerProvisioning: {
        execute: async () => ({
          conversation: { id: 'conversation-1' },
        }),
      } as never,
      computerRepository: fakeComputerRepository(computers),
    });

    const response = await app.request('/api/v1/coworkers', {
      method: 'POST',
      headers: headers('hire-1'),
      body: JSON.stringify({
        name: 'Riley',
        role: 'Support',
        summary: 'Handles support tickets.',
        computer_id: computerId,
      }),
    });
    expect(response.status).toBe(201);
    const body = CreateCoworkerResponseSchema.parse(await response.json());

    // The assertion of record: the definition actually persisted with the
    // Computer binding, not merely echoed back in the response.
    const stored = definitions.get(body.agent_id);
    expect(stored?.computerId).toBe(computerId);
  });

  it('hires without a Computer when none is requested, keeping computer_id null', async () => {
    const definitions = new Map<string, AgentDefinition>();
    const app = buildApp();
    registerCoworkerAuthoringRoute(app, {
      config: config(),
      agentRegistry: fakeAgentRegistry(definitions),
      coworkerProvisioning: {
        execute: async () => ({
          conversation: { id: 'conversation-2' },
        }),
      } as never,
      computerRepository: fakeComputerRepository(new Map()),
    });

    const response = await app.request('/api/v1/coworkers', {
      method: 'POST',
      headers: headers('hire-2'),
      body: JSON.stringify({
        name: 'Jordan',
        role: 'Support',
        summary: 'Handles support tickets.',
      }),
    });
    expect(response.status).toBe(201);
    const body = CreateCoworkerResponseSchema.parse(await response.json());
    expect(definitions.get(body.agent_id)?.computerId).toBeNull();
  });

  it('rejects hiring onto a Computer from another workspace instead of silently ignoring it', async () => {
    const definitions = new Map<string, AgentDefinition>();
    const computers = new Map<string, Computer>();
    const foreignComputerId = randomUUID();
    computers.set(foreignComputerId, {
      id: foreignComputerId,
      tenantId,
      workspaceId: otherWorkspaceId,
      kind: 'vps',
      name: 'Foreign Computer',
      status: 'offline',
      createdAt: '2026-09-08T09:00:00.000Z',
      updatedAt: '2026-09-08T09:00:00.000Z',
    });

    const app = buildApp();
    registerCoworkerAuthoringRoute(app, {
      config: config(),
      agentRegistry: fakeAgentRegistry(definitions),
      coworkerProvisioning: {
        execute: async () => ({
          conversation: { id: 'conversation-3' },
        }),
      } as never,
      computerRepository: fakeComputerRepository(computers),
    });

    const response = await app.request('/api/v1/coworkers', {
      method: 'POST',
      headers: headers('hire-3'),
      body: JSON.stringify({
        name: 'Casey',
        role: 'Support',
        summary: 'Handles support tickets.',
        computer_id: foreignComputerId,
      }),
    });
    expect(response.status).toBe(404);
    // Nothing was hired: a rejected placement must not leave a Coworker
    // silently created without the binding it asked for.
    expect(definitions.size).toBe(0);
  });
});

function buildApp(): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  app.onError((error, context) => {
    if (error instanceof HttpError)
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.path ? { path: error.path } : {}),
          },
        },
        error.status,
      );
    return context.json(
      {
        error: {
          code: 'internal_error',
          message: 'The request could not be completed.',
        },
      },
      500,
    );
  });
  return app;
}

function fakeAgentRegistry(
  definitions: Map<string, AgentDefinition>,
): AgentRegistry {
  const versions = new Map<string, ManagedAgentVersion>();
  return {
    importAgent: async (command: ImportAgentAtomicCommand) => {
      definitions.set(command.definition.id, command.definition);
      versions.set(command.version.id, command.version);
      return {
        kind: 'created',
        definition: command.definition,
        version: command.version,
      };
    },
    publishAgentVersion: async (command: PublishAgentAtomicCommand) => {
      const version = versions.get(command.versionId);
      if (!version) throw new Error('version not found');
      const published = {
        ...version,
        status: 'published' as const,
        publishedAt: '2026-09-08T10:00:00.000Z',
      };
      versions.set(command.versionId, published);
      return published;
    },
    findDefinition: async () => null,
    findVersion: async () => null,
    listVersionsForOwner: async () => null,
  };
}

function fakeComputerRepository(
  store: Map<string, Computer>,
): Pick<ComputerRepository, 'findById'> {
  return {
    findById: async (input) => {
      const found = store.get(input.id);
      return found &&
        found.tenantId === input.tenantId &&
        found.workspaceId === input.workspaceId
        ? found
        : null;
    },
  };
}

function headers(idempotencyKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
  };
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'error',
    serviceName: 'coworker-api-test',
    directChatPlane: 'execution_runtime',
    productWorkSurface: 'composed',
    teamCompletionApprovalRequired: false,
    skillRegistryRoot: '/tmp/coworker-api-test',
    chat: { activationBurstDebounceMs: 2_000 },
    serviceAccounts: [
      {
        serviceAccountId: principalId,
        token,
        tenantId,
        workspaceId,
        policyVersion: 'policy-coworker-api',
        disabled: false,
      },
    ],
    paseo: {
      wsUrl: 'ws://127.0.0.1:6767/ws',
      agentCwd: '/tmp/coworker-api-test',
      provider: 'opencode',
      workspaceTitle: 'Coworker API Test',
      connectTimeoutMs: 1000,
      connectTimeoutSource: 'default',
      executionTimeoutMs: 1000,
      executionTimeoutSource: 'default',
      sessionRpcTimeoutMs: 2000,
      sessionRpcTimeoutSource: 'default',
    },
  } as AppConfig;
}
