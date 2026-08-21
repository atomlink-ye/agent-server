import { describe, expect, it, vi } from 'vitest';

import { ResolveAgentVersion } from './resolve-agent-version.js';

const scope = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account',
  principalId: 'principal',
};

function managed(
  status: 'draft' | 'published',
  instructions = 'managed instructions',
) {
  return {
    id: 'version-1',
    tenantId: scope.tenantId,
    principalType: scope.principalType,
    principalId: scope.principalId,
    status,
    package: {
      spec: {
        instructions,
        tools: [],
        skills: [],
        runtime: { modelPolicyRef: 'free-only' },
      },
    },
  } as never;
}

describe('ResolveAgentVersion', () => {
  it('does not fall back when an owner-matching managed draft exists', async () => {
    const findVersion = vi.fn(
      async (_owner: unknown, _versionId: string) => managed('draft'),
    );
    const findVersionByTenant = vi.fn(
      async (input: { readonly tenantId: string; readonly versionId: string }) =>
        findVersion(
          {
            tenantId: input.tenantId,
            workspaceId: scope.workspaceId,
            principalType: scope.principalType,
            principalId: scope.principalId,
          },
          input.versionId,
        ),
    );
    const findLegacy = vi.fn(async () => ({ instructions: 'legacy' })) as never;
    const resolver = new ResolveAgentVersion(
      { findVersion, findVersionByTenant },
      { findPublishedAgentVersionById: findLegacy },
      { resolve: vi.fn(async () => null) },
    );

    await expect(
      resolver.resolvePublished('version-1', scope),
    ).resolves.toBeNull();
    expect(findLegacy).not.toHaveBeenCalled();
    expect(findVersion).toHaveBeenCalledWith(
      {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        principalType: scope.principalType,
        principalId: scope.principalId,
      },
      'version-1',
    );
  });

  it('returns only managed identity, source, and instructions when published', async () => {
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => managed('published', 'managed')),
        findVersionByTenant: vi.fn(async () => managed('published', 'managed')),
      },
      { findPublishedAgentVersionById: vi.fn() },
      { resolve: vi.fn(async () => null) },
    );

    await expect(
      resolver.resolvePublished('version-1', scope),
    ).resolves.toEqual({
      source: 'managed',
      id: 'version-1',
      instructions: 'managed',
      modelPolicyRef: 'free-only',
      proposalLimit: 0,
      skills: [],
      toolRefs: [],
    });
  });

  it('falls back to a legacy published version only when managed is absent', async () => {
    const findLegacy = vi.fn(async () => ({
      id: 'version-1',
      instructions: 'legacy',
      proposalLimit: 0,
    })) as never;
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => null),
        findVersionByTenant: vi.fn(async () => null),
      },
      { findPublishedAgentVersionById: findLegacy },
      { resolve: vi.fn(async () => null) },
    );

    await expect(
      resolver.resolvePublished('version-1', scope),
    ).resolves.toEqual({
      source: 'legacy',
      id: 'version-1',
      instructions: 'legacy',
      modelPolicyRef: 'free-only',
      proposalLimit: 0,
      skills: [],
      toolRefs: [],
    });
    expect(findLegacy).toHaveBeenCalledWith('version-1', scope);
  });
});
