import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createManagedAgentDefinition } from '../../../domain/agents/managed-agent-definition.js';
import type { ApiEnvironment } from '../http-types.js';
import { registerAgentWorkCatalogRoute } from './agent-work-catalog.js';

const tenantId = 'tenant-catalog';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const principalId = 'svc-catalog';
const definitionId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const agentIds = [
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const;

describe('Definition-first Work catalog bindings', () => {
  it('binds two Coworkers and returns the reverse availability view', async () => {
    const definition = {
      id: definitionId,
      owner: {
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId,
      },
      name: 'Research brief',
      description: 'Produce a concise research brief.',
      createdAt: '2026-09-09T00:00:00.000Z',
    };
    const version = {
      id: versionId,
      definitionId,
      owner: definition.owner,
      status: 'published' as const,
      source: {
        kind: 'single_worker' as const,
        workerVersionId: '66666666-6666-4666-8666-666666666666',
        environmentVersionId: '77777777-7777-4777-8777-777777777777',
        memoryVersionIds: [],
      },
      fingerprint: 'sha256:' + 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z',
      publishedAt: '2026-09-09T00:00:00.000Z',
    };
    const agents = agentIds.map((id, index) =>
      createManagedAgentDefinition({
        id,
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId,
        normalizedName: `worker-${index + 1}`,
        displayName: `Worker ${index + 1}`,
      }),
    );
    const bindings: string[] = [];
    const app = new Hono<ApiEnvironment>();
    registerAgentWorkCatalogRoute(app, {
      config: {
        serviceAccounts: [
          {
            serviceAccountId: principalId,
            token: 'token',
            tenantId,
            workspaceId,
            policyVersion: 'test',
            disabled: false,
          },
        ],
      } as never,
      agents: {
        findDefinition: async (_owner, id) =>
          agents.find((agent) => agent.id === id) ?? null,
      },
      definitions: {
        findDefinition: async () => definition,
        findPublishedVersion: async () => version,
        listProductVersions: async () => ({
          items: [
            {
              definition,
              version,
              authorSource: {},
              authorFingerprint: 'sha256:' + 'b'.repeat(64),
              resolvedFingerprint: null,
            },
          ],
          nextCursor: null,
        }),
        listAgentWorkBindingsForDefinition: async () =>
          bindings.map((agentDefinitionId) => ({
            agentDefinitionId,
            definitionVersionId: versionId,
          })),
        associateAgentWorkflow: async ({ agentDefinitionId }) => {
          if (!bindings.includes(agentDefinitionId))
            bindings.push(agentDefinitionId);
        },
      },
    });

    for (const agentId of agentIds) {
      const response = await app.request(
        `/api/v1/work-definitions/${definitionId}/agents/${agentId}`,
        {
          method: 'PUT',
          headers: {
            authorization: 'Bearer token',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ definition_version_id: versionId }),
        },
      );
      expect(response.status).toBe(200);
    }
    const response = await app.request(
      `/api/v1/work-definitions/${definitionId}/agents`,
      {
        headers: { authorization: 'Bearer token' },
      },
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json()).agents.map(
        (agent: { agent_definition_id: string }) => agent.agent_definition_id,
      ),
    ).toEqual([...agentIds]);
  });
});
