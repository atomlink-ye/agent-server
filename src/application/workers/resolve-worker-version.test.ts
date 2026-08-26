import { describe, expect, it, vi } from 'vitest';

import { createWorkerDefinition } from '../../domain/workers/worker-definition.js';
import { parseWorkerPackage } from '../../domain/workers/worker-package.js';
import {
  createWorkerDraft,
  publishWorkerVersion,
} from '../../domain/workers/worker-version.js';
import type { SkillCatalogPort } from '../extensions/skill-catalog.js';
import { ResolveWorkerVersion } from './resolve-worker-version.js';

const source = `apiVersion: agent-server/v1alpha1
kind: Worker
metadata:
  name: exact-owner-worker
spec:
  description: Exact owner Worker
  instructions: Execute only for the owning workspace.
  runtime: { provider: paseo, modelPolicyRef: free-only, mode: isolated }
  tools: []
  skills: []
  input: { schema: { type: object, properties: {}, additionalProperties: false }, prompt: Work }
  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }
  memory: { policy: workspace_snapshot, proposalLimit: 0 }
  permissions: { network: none, filesystem: none }
  completion: { type: executable, command: done }
`;

const owner = {
  tenantId: 'tenant-a',
  workspaceId: '00000000-0000-4000-8000-000000000101',
  principalType: 'service_account',
  principalId: 'service-a',
};

function publishedWorker() {
  const definition = createWorkerDefinition({
    ...owner,
    id: '00000000-0000-4000-8000-000000000201',
    normalizedName: 'exact-owner-worker',
    displayName: 'exact-owner-worker',
  });
  return publishWorkerVersion(
    createWorkerDraft({
      definition,
      parsed: parseWorkerPackage(source),
      id: '00000000-0000-4000-8000-000000000202',
    }),
  );
}

const emptySkills: SkillCatalogPort = {
  resolve: async () => null,
};

describe('ResolveWorkerVersion exact owner scope', () => {
  it('passes the complete authenticated owner to the registry', async () => {
    const version = publishedWorker();
    const findVersion = vi.fn(async () => version);
    const service = new ResolveWorkerVersion({ findVersion }, emptySkills);

    const resolved = await service.resolvePublished(version.id, owner, {
      resolveExtensions: false,
    });

    expect(resolved?.id).toBe(version.id);
    expect(findVersion).toHaveBeenCalledWith(owner, version.id);
  });

  it('does not resolve a same-tenant Worker from another workspace', async () => {
    const version = publishedWorker();
    const findVersion = vi.fn(async (requestedOwner: typeof owner) =>
      requestedOwner.workspaceId === owner.workspaceId ? version : null,
    );
    const service = new ResolveWorkerVersion({ findVersion }, emptySkills);

    const resolved = await service.resolvePublished(version.id, {
      ...owner,
      workspaceId: '00000000-0000-4000-8000-000000000999',
    });

    expect(resolved).toBeNull();
    expect(findVersion).toHaveBeenCalledWith(
      {
        ...owner,
        workspaceId: '00000000-0000-4000-8000-000000000999',
      },
      version.id,
    );
  });

  it('does not resolve a same-workspace Worker from another principal', async () => {
    const version = publishedWorker();
    const findVersion = vi.fn(async (requestedOwner: typeof owner) =>
      requestedOwner.principalId === owner.principalId ? version : null,
    );
    const service = new ResolveWorkerVersion({ findVersion }, emptySkills);

    expect(
      await service.resolvePublished(version.id, {
        ...owner,
        principalId: 'service-b',
      }),
    ).toBeNull();
  });
});
