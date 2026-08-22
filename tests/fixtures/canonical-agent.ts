import { importAgent } from '../../src/application/agents/import-agent.js';
import { publishAgentVersion } from '../../src/application/agents/publish-agent-version.js';
import { ResolveAgentVersion } from '../../src/application/agents/resolve-agent-version.js';
import { PostgresAgentRegistry, type PostgresQueryable } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import type { AccessContext } from '../../src/platform/access-context.js';

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
  const ids = [options.definitionId, options.versionId].filter(
    (value): value is string => Boolean(value),
  );
  const registry = new PostgresAgentRegistry(database);
  const source = canonicalAgentSource({
    name: options.name ?? 'Canonical Test Agent',
    description: options.description ?? 'Canonical managed Agent test fixture.',
    instructions: options.instructions ?? 'Return the input unchanged.',
  });
  const seed = options.definitionId ?? options.versionId ?? options.name ?? 'default';
  const imported = await importAgent(registry, {
    accessContext,
    idempotencyKey: `test-agent-import:${seed}`,
    source,
    ...(options.now ? { now: () => options.now! } : {}),
    ...(ids.length > 0
      ? {
          idFactory: () => {
            const value = ids.shift();
            if (!value) throw new Error('Canonical Agent fixture id factory exhausted.');
            return value;
          },
        }
      : {}),
  });
  const version =
    imported.version.status === 'published'
      ? imported.version
      : await publishAgentVersion(registry, {
          accessContext,
          idempotencyKey: `test-agent-publish:${imported.version.id}`,
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
  return [
    'apiVersion: agent-server/v1alpha1',
    'kind: ManagedAgent',
    'metadata:',
    `  name: ${JSON.stringify(input.name)}`,
    'spec:',
    `  description: ${JSON.stringify(input.description)}`,
    `  instructions: ${JSON.stringify(input.instructions)}`,
    '  runtime:',
    '    provider: paseo',
    '    modelPolicyRef: free-only',
    '    mode: isolated',
    '  tools: []',
    '  skills: []',
    '  input:',
    '    schema:',
    '      type: object',
    '      properties:',
    '        text:',
    '          type: string',
    '      required: [text]',
    '      additionalProperties: false',
    '    prompt: Return {{input.text}}.',
    '  session:',
    '    invocation: fresh_per_invocation',
    '    followUps: queued',
    '    binding: reusable',
    '  memory:',
    '    policy: workspace_snapshot',
    '    proposalLimit: 0',
    '  permissions:',
    '    network: none',
    '    filesystem: workspace_read',
    '  completion:',
    '    type: executable',
    '    command: done',
    '',
  ].join('\n');
}
