import { randomUUID } from 'node:crypto';

import { validateProductWorkDefinition } from '../../../src/application/work/validate-product-work-definition.js';
import { fingerprintWorkDefinitionSource } from '../../../src/domain/work/work-definition-source.js';
import { PostgresWorkDefinitionSourceRepository } from '../../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

export async function seedPublishedWorkDefinition(
  db: SeedDatabase,
  owner: HarnessOwner,
  options: {
    readonly agentVersionId: string;
    readonly environmentVersionId: string;
    readonly agentDefinitionId?: string;
    readonly definitionId?: string;
    readonly versionId?: string;
    readonly name?: string;
    readonly inputField?: string;
    readonly now?: string;
  },
): Promise<{ definitionId: string; versionId: string }> {
  const definitionId = options.definitionId ?? randomUUID();
  const versionId = options.versionId ?? randomUUID();
  const name = options.name ?? 'Harness Product Work';
  const inputField = options.inputField ?? 'query';
  const now = options.now ?? HARNESS_NOW;
  const source = {
    kind: 'single_agent' as const,
    agentVersionId: options.agentVersionId,
    environmentVersionId: options.environmentVersionId,
    memoryVersionIds: [],
    inputSchema: {
      type: 'object' as const,
      properties: { [inputField]: { type: 'string' as const } },
      required: [inputField],
      additional_properties: false,
    },
  };
  const parsed = validateProductWorkDefinition(`apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
  description: ${name}
spec:
  kind: single_agent
  agent_version_id: ${options.agentVersionId}
  environment_version_id: ${options.environmentVersionId}
  input_schema:
    type: object
    properties:
      ${inputField}:
        type: string
    required: [${inputField}]
    additional_properties: false
`);
  if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));

  const repository = new PostgresWorkDefinitionSourceRepository(db);
  await repository.publish({
    definitionId,
    versionId,
    owner,
    name,
    description: `${name} fixture`,
    source,
    fingerprint: fingerprintWorkDefinitionSource(source),
    authorSource: parsed.document,
    authorFingerprint: parsed.fingerprint,
    now,
  });
  if (options.agentDefinitionId) {
    await repository.associateAgentWorkflow({
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      agentDefinitionId: options.agentDefinitionId,
      definitionId,
      now,
    });
  }
  return { definitionId, versionId };
}
