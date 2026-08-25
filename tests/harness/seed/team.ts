import { randomUUID } from 'node:crypto';

import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

export async function seedPublishedTeamVersion(
  db: SeedDatabase,
  owner: HarnessOwner,
  options: {
    readonly definitionId?: string;
    readonly versionId?: string;
    readonly environmentVersionId: string;
    readonly workerVersionId: string;
    readonly name?: string;
    readonly now?: string;
  },
): Promise<{ definitionId: string; versionId: string }> {
  const definitionId = options.definitionId ?? randomUUID();
  const versionId = options.versionId ?? randomUUID();
  const name = options.name ?? 'Harness Team';
  const now = options.now ?? HARNESS_NOW;
  await db.query(
    `INSERT INTO team_definitions
      (id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'Harness fixture',$7,$7)
     ON CONFLICT (id) DO NOTHING`,
    [
      definitionId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      name,
      now,
    ],
  );
  await db.query(
    `INSERT INTO team_versions
      (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,
       description,spec,environment_version_id,created_at,updated_at,published_at)
     VALUES($1,$2,$3,$4,$5,$6,'published',$7,'Harness fixture',$8::jsonb,$9,$10,$10,$10)
     ON CONFLICT (id) DO NOTHING`,
    [
      versionId,
      definitionId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      name,
      JSON.stringify({
        lead: { name: 'lead', workerVersionId: options.workerVersionId },
        roster: [
          { name: 'reviewer', workerVersionId: options.workerVersionId },
        ],
        environmentVersionId: options.environmentVersionId,
      }),
      options.environmentVersionId,
      now,
    ],
  );
  return { definitionId, versionId };
}
