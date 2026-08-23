import { randomUUID } from 'node:crypto';

import { importAgent } from '../../src/application/agents/import-agent.js';
import { publishAgentVersion } from '../../src/application/agents/publish-agent-version.js';
import { ResolveAgentVersion } from '../../src/application/agents/resolve-agent-version.js';
import {
  PostgresAgentRegistry,
  type PostgresQueryable,
} from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import type { AccessContext } from '../../src/domain/access-context.js';

export interface CanonicalAgentFixtureOptions {
  readonly definitionId?: string;
  readonly versionId?: string;
  readonly name?: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly now?: Date;
}

export async function seedCanonicalPublishedAgent(
  database: PostgresQueryable,
  accessContext: AccessContext,
  options: CanonicalAgentFixtureOptions = {},
) {
  const definitionId = options.definitionId ?? randomUUID();
  const versionId = options.versionId ?? randomUUID();
  const ids = [definitionId, versionId];
  const registry = new PostgresAgentRegistry(database);
  const source = canonicalAgentSource({
    name: options.name ?? 'Canonical Test Agent',
    description: options.description ?? 'Canonical managed Agent test fixture.',
    instructions: options.instructions ?? 'Return the input unchanged.',
  });
  const imported = await importAgent(registry, {
    accessContext,
    idempotencyKey: `test-agent-import:${definitionId}`,
    source,
    ...(options.now ? { now: () => options.now! } : {}),
    idFactory: () => {
      const value = ids.shift();
      if (!value)
        throw new Error('Canonical Agent fixture id factory exhausted.');
      return value;
    },
  });
  const version =
    imported.version.status === 'published'
      ? imported.version
      : await publishAgentVersion(registry, {
          accessContext,
          idempotencyKey: `test-agent-publish:${versionId}`,
          versionId: imported.version.id,
        });
  return { registry, definition: imported.definition, version } as const;
}

export function canonicalAgentResolver(database: PostgresQueryable) {
  const registry = new PostgresAgentRegistry(database);
  return new ResolveAgentVersion(registry, { resolve: async () => null });
}

export function canonicalAgentSource(input: {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}): string {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: ${input.name}
spec:
  description: ${input.description}
  instructions: ${input.instructions}
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
