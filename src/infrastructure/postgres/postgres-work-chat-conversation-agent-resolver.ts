import type { WorkChatConversationAgentDefinitionResolver } from '../../application/work-chat/work-chat-wake-delivery.js';
import type { PostgresQueryable } from './postgres-conversation-repository.js';

type AgentMemberRow = {
  member_id: string;
};

/**
 * Production source for the agent identity used by a Work Chat wake. This is
 * identity discovery only; appendMessage still performs the authoritative
 * membership check in its write transaction.
 */
export class PostgresWorkChatConversationAgentResolver implements WorkChatConversationAgentDefinitionResolver {
  public constructor(private readonly database: PostgresQueryable) {}

  public async resolve(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
    readonly conversationId: string;
  }): Promise<string | null> {
    const result = await this.database.query<AgentMemberRow>(
      `SELECT member_id
       FROM conversation_members
       WHERE tenant_id=$1 AND conversation_id=$2 AND member_type='agent_definition'
       ORDER BY member_id
       LIMIT 2`,
      [input.tenantId, input.conversationId],
    );
    const rows = result.rows ?? [];
    if (rows.length > 1) {
      throw new Error(
        'Work Chat wake conversation has multiple agent definitions.',
      );
    }
    return rows[0]?.member_id ?? null;
  }
}
