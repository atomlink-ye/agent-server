import { describe, expect, it } from 'vitest';

import { fingerprintWorkDefinitionSource } from '../../domain/work/work-definition-source.js';
import type { AccessContext } from '../../platform/access-context.js';
import { ResolveWorkDefinition } from './resolve-work-definition.js';

const access: AccessContext = {
  tenantId: 'tenant-a',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  principalType: 'service_account',
  principalId: 'sa-a',
  policySnapshotVersion: 'v1',
};

const definitionId = '22222222-2222-4222-8222-222222222222';
const definitionVersionId = '33333333-3333-4333-8333-333333333333';
const agentVersionId = '44444444-4444-4444-8444-444444444444';
const environmentVersionId = '55555555-5555-4555-8555-555555555555';
const memoryVersionId = '66666666-6666-4666-8666-666666666666';

const source = {
  kind: 'single_agent' as const,
  agentVersionId,
  environmentVersionId,
  memoryVersionIds: [memoryVersionId],
};

describe('ResolveWorkDefinition authored source', () => {
  it('resolves Agent + Environment + Memory into one immutable composition', async () => {
    const resolver = new ResolveWorkDefinition({
      agents: {
        findDefinition: async () => null,
        findVersion: async (_owner: unknown, id: string) =>
          id === agentVersionId
            ? ({
                id,
                status: 'published',
                fingerprint: 'sha256:agent',
              } as any)
            : null,
      } as any,
      agentResolution: {
        resolvePublished: async (id: string) =>
          id === agentVersionId
            ? ({
                source: 'managed',
                id,
                instructions: 'research',
                modelPolicyRef: 'free-only',
                proposalLimit: 1,
                skills: [
                  {
                    ref: 'research-skill',
                    digest: 'a'.repeat(64),
                    requiredToolRefs: ['memory://read'],
                  },
                ],
                toolRefs: ['memory://read'],
              } as any)
            : null,
      },
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      environments: {
        findVersion: async (_owner: unknown, id: string) =>
          id === environmentVersionId
            ? ({
                id,
                status: 'published',
                fingerprint: 'sha256:environment',
              } as any)
            : null,
      },
      authoredDefinitions: {
        findDefinition: async () => ({
          id: definitionId,
          owner: access,
          name: 'Research Work',
          description: 'one Agent with explicit resources',
          createdAt: '2026-08-16T00:00:00.000Z',
        }),
        findPublishedVersion: async () => ({
          id: definitionVersionId,
          definitionId,
          owner: access,
          status: 'published',
          source,
          fingerprint: fingerprintWorkDefinitionSource(source),
          createdAt: '2026-08-16T00:00:00.000Z',
          publishedAt: '2026-08-16T00:00:00.000Z',
        }),
      },
      memories: {
        findVersion: async (id: string) =>
          id === memoryVersionId
            ? {
                versionId: id,
                memoryId: '77777777-7777-4777-8777-777777777777',
                storeId: '88888888-8888-4888-8888-888888888888',
                path: 'principles.md',
                content: 'prefer evidence',
                contentSha256: 'b'.repeat(64),
              }
            : null,
      },
    });

    const resolved = await resolver.resolve({
      definitionId,
      definitionVersionId,
      accessContext: access,
    });

    expect(resolved.kind).toBe('single_agent');
    expect(resolved.executionPolicy.invokable).toEqual({
      kind: 'agent',
      versionId: agentVersionId,
    });
    expect(resolved.environment).toEqual({
      versionId: environmentVersionId,
      fingerprint: 'sha256:environment',
    });
    expect(resolved.memories).toEqual([
      {
        logicalName: 'principles.md',
        versionId: memoryVersionId,
        fingerprint: `sha256:${'b'.repeat(64)}`,
      },
    ]);
    expect(resolved.participants[0]).toMatchObject({
      role: 'primary',
      agentVersionId,
      toolRefs: ['memory://read'],
    });
    expect(resolved.executionPolicy.requiredRuntimeCapabilities).toEqual([
      'external_workspace',
      'platform_mcp',
    ]);
  });
});
