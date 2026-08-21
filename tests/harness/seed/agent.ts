import { randomUUID } from 'node:crypto';

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
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = options.now ?? HARNESS_NOW;
  const canonicalPackage = JSON.stringify({
    apiVersion: 'agentserver.dev/v1alpha1',
    kind: 'AgentDefinition',
    metadata: { name: normalizedName },
    spec: {
      instructions: options.instructions ?? 'Handle deterministic harness work.',
      model_policy_ref: 'free-only',
      proposal_limit: 0,
      tools: [],
      skills: [],
    },
  });
  await db.query(
    `INSERT INTO agent_definitions
      (id,tenant_id,workspace_id,principal_type,principal_id,name,managed_discriminator,
       normalized_name,role_label,summary,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'managed_agent_v1',$7,'worker','Harness fixture',$8,$8)
     ON CONFLICT (id) DO NOTHING`,
    [
      definitionId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      name,
      normalizedName,
      now,
    ],
  );
  await db.query(
    `INSERT INTO agent_versions
      (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,
       description,instructions,managed_discriminator,canonical_package,fingerprint,
       pattern_metadata,compiler_metadata,policy_snapshot,reference_snapshot,
       tool_skill_snapshot,validation_report,compiled_package,execution_snapshot,
       created_at,updated_at,published_at)
     VALUES($1,$2,$3,$4,$5,$6,'published',$7,'Harness fixture',$8,'managed_agent_v1',
       $9::jsonb,$10,$11::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$13::jsonb,$14::jsonb,
       $11::jsonb,$11::jsonb,$15,$15,$15)
     ON CONFLICT (id) DO NOTHING`,
    [
      versionId,
      definitionId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      name,
      options.instructions ?? 'Handle deterministic harness work.',
      canonicalPackage,
      'a'.repeat(64),
      '{}',
      JSON.stringify({ modelPolicyRef: 'free-only' }),
      JSON.stringify({ tools: [], skills: [] }),
      JSON.stringify({ valid: true, metadata: { normalizedName } }),
      now,
    ],
  );
  return { definitionId, versionId };
}
