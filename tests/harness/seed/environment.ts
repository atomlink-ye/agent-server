import { createHash, randomUUID } from 'node:crypto';

import {
  canonicalizeManagedEnvironmentJson,
  type ManagedEnvironmentPackage,
} from '../../../src/domain/environments/managed-environment-package.js';

import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

export async function seedEnvironmentVersion(
  db: SeedDatabase,
  owner: HarnessOwner,
  options: {
    readonly definitionId?: string;
    readonly versionId?: string;
    readonly name?: string;
    readonly now?: string;
    readonly provider?: ManagedEnvironmentPackage['spec']['provider'];
  } = {},
): Promise<{ definitionId: string; versionId: string }> {
  const definitionId = options.definitionId ?? randomUUID();
  const versionId = options.versionId ?? randomUUID();
  const name = options.name ?? 'Harness Environment';
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = options.now ?? HARNESS_NOW;
  // A real ManagedEnvironment package, not `{}`. Work runtime execution rejects
  // an Environment whose spec is absent or unsupported
  // (`AgentRunExecutor.resolveEnvironmentConfiguration`), so an empty package
  // seeds a row that reads back fine through the registry but can never run.
  // Seeding the supported shape is what lets a Product WorkRun be exercised
  // deterministically rather than only created and read.
  const canonicalPackage: ManagedEnvironmentPackage = {
    apiVersion: 'agent-server/v1alpha1',
    kind: 'ManagedEnvironment',
    metadata: { name: normalizedName },
    spec: {
      adapter: 'paseo',
      provider: options.provider ?? 'opencode',
      modelPolicyRef: 'free-only',
      runtimeCellPolicy: 'per_runtime_session',
    },
  };
  const canonicalJson = canonicalizeManagedEnvironmentJson(canonicalPackage);
  const fingerprint = `sha256:${createHash('sha256')
    .update(canonicalJson)
    .digest('hex')}`;
  await db.query(
    `INSERT INTO environment_definitions
      (id,tenant_id,principal_type,principal_id,normalized_name,display_name,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (id) DO NOTHING`,
    [
      definitionId,
      owner.tenantId,
      owner.principalType,
      owner.principalId,
      normalizedName,
      name,
      now,
    ],
  );
  await db.query(
    `INSERT INTO environment_versions
      (id,definition_id,tenant_id,principal_type,principal_id,status,display_name,
       canonical_package,fingerprint,created_at,updated_at,published_at)
     VALUES($1,$2,$3,$4,$5,'published',$6,$7::jsonb,$8,$9,$9,$9)
     ON CONFLICT (id) DO NOTHING`,
    [
      versionId,
      definitionId,
      owner.tenantId,
      owner.principalType,
      owner.principalId,
      name,
      canonicalJson,
      fingerprint,
      now,
    ],
  );
  return { definitionId, versionId };
}
