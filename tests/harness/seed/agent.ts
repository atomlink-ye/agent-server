import { randomUUID } from 'node:crypto';

import { importAgent } from '../../../src/application/agents/import-agent.js';
import { publishAgentVersion } from '../../../src/application/agents/publish-agent-version.js';
import { PostgresAgentRegistry } from '../../../src/infrastructure/postgres/postgres-agent-registry.js';
import type { AccessContext } from '../../../src/platform/access-context.js';
import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

export async function seedPublishedAgentVersion(
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
  const name = options.name ?? 'Harness Agent';
  const instructions =
    options.instructions ?? 'Handle deterministic harness work.';
  const now = options.now ?? HARNESS_NOW;
  const ids = [definitionId, versionId];
  const accessContext: AccessContext = {
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    principalType: owner.principalType,
    principalId: owner.principalId,
    policySnapshotVersion: 'harness-policy-v1',
  };
  const registry = new PostgresAgentRegistry(db);
  const source = managedAgentSource(name, instructions);
  const imported = await importAgent(registry, {
    accessContext,
    idempotencyKey: `harness-agent-import:${definitionId}`,
    source,
    now: () => new Date(now),
    idFactory: () => {
      const id = ids.shift();
      if (!id) throw new Error('Harness Agent id factory exhausted.');
      return id;
    },
  });
  const published =
    imported.version.status === 'published'
      ? imported.version
      : await publishAgentVersion(registry, {
          accessContext,
          idempotencyKey: `harness-agent-publish:${versionId}`,
          versionId: imported.version.id,
        });
  return { definitionId: imported.definition.id, versionId: published.id };
}

function managedAgentSource(name: string, instructions: string): string {
  return [
    'apiVersion: agent-server/v1alpha1',
    'kind: ManagedAgent',
    'metadata:',
    `  name: ${JSON.stringify(name)}`,
    'spec:',
    '  description: Deterministic Agent Server harness fixture.',
    `  instructions: ${JSON.stringify(instructions)}`,
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
    '    prompt: Handle {{input.text}}.',
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
