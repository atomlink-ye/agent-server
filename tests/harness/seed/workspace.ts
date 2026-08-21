import { randomUUID } from 'node:crypto';

import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

export async function seedWorkspace(
  db: SeedDatabase,
  options: {
    readonly tenantId?: string;
    readonly workspaceId?: string;
    readonly principalId?: string;
    readonly name?: string;
    readonly now?: string;
  } = {},
): Promise<HarnessOwner> {
  const owner: HarnessOwner = {
    tenantId: options.tenantId ?? `tenant-${randomUUID()}`,
    workspaceId: options.workspaceId ?? randomUUID(),
    principalType: 'service_account',
    principalId: options.principalId ?? `principal-${randomUUID()}`,
  };
  const now = options.now ?? HARNESS_NOW;
  await db.query(
    `INSERT INTO workspaces
      (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (id) DO NOTHING`,
    [
      owner.workspaceId,
      owner.tenantId,
      owner.principalType,
      owner.principalId,
      options.name ?? 'Harness Workspace',
      now,
    ],
  );
  return owner;
}
