import { randomUUID } from 'node:crypto';

import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

export async function seedConversation(
  db: SeedDatabase,
  owner: Pick<HarnessOwner, 'tenantId'>,
  options: {
    readonly conversationId?: string;
    readonly kind?: 'direct' | 'group';
    readonly now?: string;
  } = {},
): Promise<{ id: string }> {
  const id = options.conversationId ?? randomUUID();
  const now = options.now ?? HARNESS_NOW;
  await db.query(
    `INSERT INTO conversations (id,tenant_id,kind,created_at,updated_at)
     VALUES($1,$2,$3,$4,$4)
     ON CONFLICT (id) DO NOTHING`,
    [id, owner.tenantId, options.kind ?? 'direct', now],
  );
  return { id };
}
