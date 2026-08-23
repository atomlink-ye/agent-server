import { describe, expect, it } from 'vitest';

import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
import { manifestEntriesForResolvedWorkDefinition } from '../../domain/work/work-composition.js';
import type { AccessContext } from '../../domain/access-context.js';
import { ResolveWorkDefinition } from './resolve-work-definition.js';

const access: AccessContext = {
  tenantId: 'tenant-a',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  principalType: 'service_account',
  principalId: 'sa-a',
  policySnapshotVersion: 'v1',
};

function singleResolver(input?: {
  readonly toolRefs?: readonly string[];
  readonly skills?: readonly {
    ref: string;
    digest: string;
    requiredToolRefs: readonly string[];
  }[];
}) {
  const definition = {
    id: '22222222-2222-4222-8222-222222222222',
  };
  const version = {
    id: '33333333-3333-4333-8333-333333333333',
    definitionId: definition.id,
    status: 'published',
    displayName: 'Researcher',
    fingerprint: 'sha256:agent',
    package: { spec: { description: 'Single research Agent' } },
  };
  return {
    definition,
    version,
    resolver: new ResolveWorkDefinition({
      agents: {
        findDefinition: async () => definition as any,
        findVersion: async () => version as any,
        findManagedDefinitionByTenant: async () => definition as any,
        findVersionByTenant: async () => version as any,
        listVersionsByTenant: async () => null,
      } as any,
      agentResolution: {
        resolvePublished: async () =>
          ({
            source: 'managed',
            id: version.id,
            instructions: 'research',
            modelPolicyRef: 'free-only',
            skills: input?.skills ?? [],
            toolRefs: input?.toolRefs ?? [],
          }) as any,
      },
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      environments: { findVersion: async () => null } as any,
    }),
  };
}

describe('ResolveWorkDefinition', () => {
  it('resolves the same single-Agent version to the same immutable fingerprint', async () => {
    const { definition, version, resolver } = singleResolver();
    const first = await resolver.resolve({
      definitionId: definition.id,
      definitionVersionId: version.id,
      accessContext: access,
    });
    const second = await resolver.resolve({
      definitionId: definition.id,
      definitionVersionId: version.id,
      accessContext: access,
    });

    expect(first.kind).toBe('single_agent');
    expect(first.executionPolicy.invokable).toEqual({
      kind: 'agent',
      versionId: version.id,
    });
    expect(first.platformCapabilities).toEqual([]);
    expect(first.resolvedFingerprint).toBe(second.resolvedFingerprint);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('classifies domain tools separately from the platform MCP capability', async () => {
    const { definition, version, resolver } = singleResolver({
      toolRefs: ['memory://read'],
    });
    const resolved = await resolver.resolve({
      definitionId: definition.id,
      definitionVersionId: version.id,
      accessContext: access,
    });
    const manifest = manifestEntriesForResolvedWorkDefinition(
      resolved,
      '2026-08-16T00:00:00.000Z',
    );
    expect(
      manifest.find((entry) => entry.resourceKind === 'definition'),
    ).toMatchObject({ resolvedFingerprint: resolved.resolvedFingerprint });

    expect(resolved.platformCapabilities).toEqual(['platform_mcp']);
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceKind: 'tool',
          requestedRef: 'memory://read',
        }),
        expect.objectContaining({
          resourceKind: 'platform_capability',
          requestedRef: 'platform_mcp',
        }),
      ]),
    );
  });

  it('resolves bounded collaboration with exact participants and Environment', async () => {
    const definition = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Market research',
      description: 'bounded collaboration',
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      principalType: access.principalType,
      principalId: access.principalId,
    };
    const version = {
      id: '55555555-5555-4555-8555-555555555555',
      definitionId: definition.id,
      status: 'published',
      name: 'Market research v1',
      description: 'bounded collaboration',
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      principalType: access.principalType,
      principalId: access.principalId,
      environmentVersionId: '66666666-6666-4666-8666-666666666666',
      publishedAt: '2026-08-16T00:00:00.000Z',
      spec: {
        lead: {
          name: 'lead',
          agentVersionId: '77777777-7777-4777-8777-777777777777',
        },
        roster: [
          {
            name: 'analyst',
            agentVersionId: '88888888-8888-4888-8888-888888888888',
          },
        ],
        environmentVersionId: '66666666-6666-4666-8666-666666666666',
      },
    };
    const resolver = new ResolveWorkDefinition({
      agents: {
        findDefinition: async () => null,
        findVersion: async (_owner: unknown, id: string) =>
          ({ id, status: 'published', fingerprint: `sha256:${id}` }) as any,
        findManagedDefinitionByTenant: async () => null,
        findVersionByTenant: async () => null,
        listVersionsByTenant: async () => null,
      } as any,
      agentResolution: {
        resolvePublished: async (id: string) =>
          ({
            source: 'managed',
            id,
            instructions: id,
            modelPolicyRef: 'free-only',
            skills: [],
            toolRefs: [],
          }) as any,
      },
      definitions: {
        findTeamDefinitionById: async () => definition as any,
        findPublishedTeamVersionById: async () => version as any,
      },
      environments: {
        findVersion: async () =>
          ({
            id: version.environmentVersionId,
            status: 'published',
            fingerprint: 'sha256:environment',
          }) as any,
      },
    });

    const resolved = await resolver.resolve({
      definitionId: definition.id,
      definitionVersionId: version.id,
      accessContext: access,
    });

    expect(resolved.kind).toBe('collaboration');
    expect(
      resolved.participants.map((item) => [item.role, item.logicalName]),
    ).toEqual([
      ['lead', 'lead'],
      ['member', 'analyst'],
    ]);
    expect(resolved.environment?.versionId).toBe(version.environmentVersionId);
    expect(resolved.platformCapabilities).toEqual([
      'collaboration',
      'platform_mcp',
    ]);
    expect(resolved.executionPolicy.requiredRuntimeCapabilities).toEqual([
      'reusable_session',
      'external_workspace',
      'platform_mcp',
    ]);
  });

  it('rejects platform Collaboration refs when authored as domain tools', async () => {
    const collaborationTool = Object.values(
      AGENT_SERVER_COLLABORATION_TOOL_REFS,
    )[0]!;
    const { definition, version, resolver } = singleResolver({
      toolRefs: [collaborationTool],
    });

    await expect(
      resolver.resolve({
        definitionId: definition.id,
        definitionVersionId: version.id,
        accessContext: access,
      }),
    ).rejects.toMatchObject({
      name: 'WorkCompositionResolutionError',
      diagnosticPath: '$.participants.primary.tools',
    });
  });

  it('fails closed when no published Definition version is resolvable', async () => {
    const resolver = new ResolveWorkDefinition({
      agents: {
        findDefinition: async () => null,
        findVersion: async () => null,
        findManagedDefinitionByTenant: async () => null,
        findVersionByTenant: async () => null,
        listVersionsByTenant: async () => null,
      } as any,
      agentResolution: { resolvePublished: async () => null },
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      environments: { findVersion: async () => null } as any,
    });

    await expect(
      resolver.resolve({
        definitionId: '99999999-9999-4999-8999-999999999999',
        definitionVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        accessContext: access,
      }),
    ).rejects.toMatchObject({
      name: 'WorkCompositionResolutionError',
      diagnosticPath: '$.definition_version_id',
    });
  });
});
