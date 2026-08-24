import { SERVICE_ACCOUNT_PRINCIPAL_TYPE } from '../../domain/access-context.js';
import type { ConversationWorkEntitlement } from '../../domain/chat/conversation-work-entitlement.js';
import type { ConversationWorkEntitlementRepository } from '../../application/ports/conversation-work-entitlement-repository.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

type EntitlementRow = {
  tenant_id: string;
  conversation_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  created_at: string | Date;
  updated_at: string | Date;
};

export class PostgresConversationWorkEntitlementRepository implements ConversationWorkEntitlementRepository {
  public constructor(private readonly db: Queryable) {}

  public async enable(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<ConversationWorkEntitlement | null> {
    if (input.principalType !== SERVICE_ACCOUNT_PRINCIPAL_TYPE) return null;
    const now = new Date().toISOString();
    // The admission predicates are deliberately in the write query. A route
    // pre-read cannot substitute for these direct/member/workspace checks.
    const result = await this.db.query<EntitlementRow>(
      `INSERT INTO conversation_work_entitlements
       (tenant_id,conversation_id,workspace_id,principal_type,principal_id,created_at,updated_at)
       SELECT c.tenant_id,c.id,$3,$4,$5,$6,$6
         FROM conversations c
        WHERE c.tenant_id=$1 AND c.id=$2 AND c.kind='direct'
          AND EXISTS (
            SELECT 1 FROM conversation_members principal
             WHERE principal.conversation_id=c.id
               AND principal.tenant_id=c.tenant_id
               AND principal.member_type='principal'
               AND principal.member_id=$5
               AND principal.member_principal_type=$4
          )
          AND EXISTS (
            SELECT 1 FROM conversation_members agent
             WHERE agent.conversation_id=c.id
               AND agent.tenant_id=c.tenant_id
               AND agent.member_type='agent_definition'
          )
          AND EXISTS (
            SELECT 1 FROM workspaces w
             WHERE w.id=$3 AND w.tenant_id=$1
               AND w.principal_type=$4 AND w.principal_id=$5
          )
       ON CONFLICT (tenant_id,conversation_id) DO UPDATE
         SET workspace_id=EXCLUDED.workspace_id,
             principal_type=EXCLUDED.principal_type,
             principal_id=EXCLUDED.principal_id,
             updated_at=EXCLUDED.updated_at
       WHERE conversation_work_entitlements.principal_type=$4
         AND conversation_work_entitlements.principal_id=$5
       RETURNING tenant_id,conversation_id,workspace_id,principal_type,
                 principal_id,created_at,updated_at`,
      [
        input.tenantId,
        input.conversationId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapEntitlement(row) : null;
  }

  public async revoke(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM conversation_work_entitlements e
       USING conversations c
        WHERE e.tenant_id=$1 AND e.conversation_id=$2
          AND e.principal_type=$3 AND e.principal_id=$4
          AND c.id=e.conversation_id AND c.tenant_id=e.tenant_id
          AND c.kind='direct'
          AND EXISTS (
            SELECT 1 FROM conversation_members principal
             WHERE principal.conversation_id=c.id
               AND principal.tenant_id=c.tenant_id
               AND principal.member_type='principal'
               AND principal.member_id=e.principal_id
               AND principal.member_principal_type=e.principal_type
          )
       RETURNING e.tenant_id`,
      [
        input.tenantId,
        input.conversationId,
        input.principalType,
        input.principalId,
      ],
    );
    return (result.rows?.length ?? result.rowCount ?? 0) > 0;
  }

  public async resolveForChatTurn(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly agentDefinitionId: string;
  }): Promise<ConversationWorkEntitlement | null> {
    const result = await this.db.query<EntitlementRow>(
      `SELECT e.tenant_id,e.conversation_id,e.workspace_id,e.principal_type,
              e.principal_id,e.created_at,e.updated_at
         FROM conversation_work_entitlements e
         JOIN conversations c
           ON c.id=e.conversation_id AND c.tenant_id=e.tenant_id
        WHERE e.tenant_id=$1 AND e.conversation_id=$2
          AND c.kind='direct'
          AND e.principal_type='service_account'
          AND EXISTS (
            SELECT 1 FROM conversation_members principal
             WHERE principal.conversation_id=e.conversation_id
               AND principal.tenant_id=e.tenant_id
               AND principal.member_type='principal'
               AND principal.member_id=e.principal_id
               AND principal.member_principal_type=e.principal_type
          )
          AND EXISTS (
            SELECT 1 FROM conversation_members agent
             WHERE agent.conversation_id=e.conversation_id
               AND agent.tenant_id=e.tenant_id
               AND agent.member_type='agent_definition'
               AND agent.member_id=$3
          )
          AND EXISTS (
            SELECT 1 FROM workspaces w
             WHERE w.id=e.workspace_id AND w.tenant_id=e.tenant_id
               AND w.principal_type=e.principal_type
               AND w.principal_id=e.principal_id
          )`,
      [input.tenantId, input.conversationId, input.agentDefinitionId],
    );
    const row = result.rows?.[0];
    return row ? mapEntitlement(row) : null;
  }
}

function mapEntitlement(row: EntitlementRow): ConversationWorkEntitlement {
  return Object.freeze({
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    workspaceId: row.workspace_id,
    principalType: SERVICE_ACCOUNT_PRINCIPAL_TYPE,
    principalId: row.principal_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
