import type { ConversationActorResolver } from '../../application/chat/chat-turn-context.js';
import { principalRef } from '../../domain/tenancy/product-context.js';

export class PostgresConversationActorResolver
  implements ConversationActorResolver
{
  public constructor(
    private readonly db: {
      query(
        sql: string,
        values?: readonly unknown[],
      ): Promise<{ rows?: readonly any[] }>;
    },
  ) {}

  public async resolve(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalId: string;
  }) {
    const result = await this.db.query(
      `SELECT member_principal_type
         FROM conversation_members
        WHERE tenant_id=$1 AND conversation_id=$2
          AND member_type='principal' AND member_id=$3
        LIMIT 2`,
      [input.tenantId, input.conversationId, input.principalId],
    );
    if ((result.rows?.length ?? 0) > 1)
      throw new Error('Conversation principal membership is ambiguous.');
    const row = result.rows?.[0];
    if (!row?.member_principal_type) return null;
    return principalRef({
      principalType: row.member_principal_type,
      principalId: input.principalId,
    });
  }
}
