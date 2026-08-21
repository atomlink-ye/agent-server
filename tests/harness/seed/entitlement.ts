import { PostgresConversationWorkEntitlementRepository } from '../../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';

import type { HarnessOwner, SeedDatabase } from './types.js';
import { HARNESS_NOW } from './types.js';

/**
 * Make a direct conversation product-Work capable using the same membership
 * predicates the production entitlement repository enforces.
 */
export async function seedWorkEntitlement(
  db: SeedDatabase,
  owner: HarnessOwner,
  input: {
    readonly conversationId: string;
    readonly agentDefinitionId: string;
    readonly now?: string;
  },
) {
  const now = input.now ?? HARNESS_NOW;
  await db.query(
    `INSERT INTO conversation_members
      (conversation_id,tenant_id,member_type,member_id,member_principal_type,joined_at)
     VALUES($1,$2,'principal',$3,$4,$5)
     ON CONFLICT (conversation_id,member_type,member_id) DO NOTHING`,
    [
      input.conversationId,
      owner.tenantId,
      owner.principalId,
      owner.principalType,
      now,
    ],
  );
  await db.query(
    `INSERT INTO conversation_members
      (conversation_id,tenant_id,member_type,member_id,joined_at)
     VALUES($1,$2,'agent_definition',$3,$4)
     ON CONFLICT (conversation_id,member_type,member_id) DO NOTHING`,
    [input.conversationId, owner.tenantId, input.agentDefinitionId, now],
  );
  const entitlement = await new PostgresConversationWorkEntitlementRepository(
    db,
  ).enable({
    tenantId: owner.tenantId,
    conversationId: input.conversationId,
    workspaceId: owner.workspaceId,
    principalType: owner.principalType,
    principalId: owner.principalId,
  });
  if (!entitlement) {
    throw new Error('failed to seed conversation Work entitlement');
  }
  return entitlement;
}
