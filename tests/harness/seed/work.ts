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
    /**
     * When provided, create a strict one-field schema. When omitted, use the
     * canonical scripted Golden Path lifecycle schema: start_work sends
     * `query`, while continue_work sends `instruction`.
     */
    readonly inputField?: string;
    readonly now?: string;
  },
): Promise<{ definitionId: string; versionId: string }> {
  const definitionId = options.definitionId ?? randomUUID();
  const versionId = options.versionId ?? randomUUID();
  const name = options.name ?? 'Harness Product Work';
  const now = options.now ?? HARNESS_NOW;
  const inputSchema = options.inputField
    ? {
        type: 'object' as const,
        properties: { [options.inputField]: { type: 'string' as const } },
        required: [options.inputField],
        additional_properties: false,
      }
    : {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const },
          instruction: { type: 'string' as const },
        },
        required: [],
        additional_properties: false,
      };
  const inputSchemaYaml = options.inputField
    ? `    properties:\n      ${options.inputField}:\n        type: string\n    required: [${options.inputField}]\n    additional_properties: false`
    : `    properties:\n      query:\n        type: string\n      instruction:\n        type: string\n    required: []\n    additional_properties: false`;
  const source = {
    kind: 'single_agent' as const,
    agentVersionId: options.agentVersionId,
    environmentVersionId: options.environmentVersionId,
    memoryVersionIds: [],
    inputSchema,
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
${inputSchemaYaml}
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

export async function seedActiveTask(
  db: SeedDatabase,
  input: {
    readonly owner: HarnessOwner;
    readonly invokableKind: string;
    readonly invokableVersionId: string;
    readonly policySnapshotVersion?: string;
    readonly inputSnapshotRef?: string;
    readonly inputFingerprint?: string;
    readonly now?: string;
  },
): Promise<{ taskId: string; reused: false }> {
  const taskId = randomUUID();
  const now = input.now ?? HARNESS_NOW;
  await db.query(
    `INSERT INTO tasks
      (id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,
       root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,
       input_snapshot_ref,input_fingerprint,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$1,0,'active','api',$7,$8,$9,$10,$11,$11)`,
    [
      taskId,
      input.owner.tenantId,
      input.owner.workspaceId,
      input.owner.principalType,
      input.owner.principalId,
      input.policySnapshotVersion ?? 'harness-policy-v1',
      input.invokableKind,
      input.invokableVersionId,
      input.inputSnapshotRef ?? `harness:${taskId}`,
      input.inputFingerprint ?? `harness:${taskId}`,
      now,
    ],
  );
  return { taskId, reused: false };
}
