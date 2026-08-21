import { randomUUID } from 'node:crypto';

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
  } = {},
): Promise<{ definitionId: string; versionId: string }> {
  const definitionId = options.definitionId ?? randomUUID();
  const versionId = options.versionId ?? randomUUID();
  const name = options.name ?? 'Harness Environment';
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const now = options.now ?? HARNESS_NOW;
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
      '{}',
      `sha256:${'e'.repeat(64)}`,
      now,
    ],
  );
  return { definitionId, versionId };
}
