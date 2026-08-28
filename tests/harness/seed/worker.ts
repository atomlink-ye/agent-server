import { randomUUID } from 'node:crypto';

import type { AccessContext } from '../../../src/domain/access-context.js';
import { importWorker } from '../../../src/application/workers/import-worker.js';
import { publishWorkerVersion } from '../../../src/application/workers/publish-worker-version.js';
import { PostgresWorkerRegistry } from '../../../src/infrastructure/postgres/postgres-worker-registry.js';
import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

export async function seedPublishedWorkerVersion(
  db: SeedDatabase,
  owner: HarnessOwner,
  options: {
    readonly definitionId?: string;
    readonly versionId?: string;
    readonly name?: string;
    readonly instructions?: string;
    readonly now?: string;
  } = {},
): Promise<{ definitionId: string; versionId: string }> {
  const definitionId = options.definitionId ?? randomUUID();
  const versionId = options.versionId ?? randomUUID();
  const name = options.name ?? 'Harness Worker';
  const now = options.now ?? HARNESS_NOW;
  const ids = [definitionId, versionId];
  const accessContext: AccessContext = {
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    principalType: owner.principalType,
    principalId: owner.principalId,
    policySnapshotVersion: 'harness-policy-v1',
  };
  const registry = new PostgresWorkerRegistry(db);
  const imported = await importWorker(registry, {
    accessContext,
    idempotencyKey: `harness-worker-import:${definitionId}`,
    source: workerSource(name, options.instructions),
    now: () => new Date(now),
    idFactory: () => {
      const id = ids.shift();
      if (!id) throw new Error('Harness Worker id factory exhausted.');
      return id;
    },
  });
  const published =
    imported.version.status === 'published'
      ? imported.version
      : await publishWorkerVersion(registry, {
          accessContext,
          idempotencyKey: `harness-worker-publish:${versionId}`,
          versionId: imported.version.id,
        });
  return { definitionId: imported.definition.id, versionId: published.id };
}

function workerSource(
  name: string,
  instructions = 'Handle deterministic worker work.',
) {
  return `apiVersion: agent-server/v1alpha1
kind: Worker
metadata:
  name: ${name}
spec:
  description: Deterministic Agent Server harness Worker fixture.
  instructions: ${instructions}
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
}
