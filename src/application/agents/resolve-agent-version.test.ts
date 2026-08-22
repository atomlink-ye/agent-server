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
    const resolver = new ResolveAgentVersion(
      { findVersion, findVersionByTenant },
      { resolve: vi.fn(async () => null) },
    );

    await expect(
      resolver.resolvePublished('version-1', scope),
    ).resolves.toBeNull();
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

  it('returns null when no managed published version exists', async () => {
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => null),
        findVersionByTenant: vi.fn(async () => null),
      },
      { resolve: vi.fn(async () => null) },
    );

    await expect(
      resolver.resolvePublished('version-1', scope),
    ).resolves.toBeNull();
  });
});
