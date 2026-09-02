import type { ConversationAgentIdentityResolver } from '../../application/work-organization/conversation-agent-identity.js';
import type { PostgresQueryable } from './postgres-conversation-repository.js';

type AgentMemberRow = {
  member_id: string;
};

/**
 * Which Coworker a chat-runtime tool call belongs to.
 *
 * A chat runtime's scope id is the AgentChatRuntime id, so the AgentDefinition
 * has to come from the conversation's `agent_definition` member. Two of them
 * would make "who claimed this" ambiguous, so that case refuses rather than
 * picking one (same rule as PostgresWorkChatConversationAgentResolver).
 */
export class PostgresConversationAgentIdentityResolver implements ConversationAgentIdentityResolver {
  public constructor(private readonly database: PostgresQueryable) {}

  public async resolve(input: {
    readonly tenantId: string;
    readonly conversationId: string;
  }): Promise<string | null> {
    const result = await this.database.query<AgentMemberRow>(
      `SELECT member_id
       FROM conversation_members
       WHERE tenant_id=$1
         AND conversation_id=$2
         AND member_type='agent_definition'
       ORDER BY member_id
       LIMIT 2`,
      [input.tenantId, input.conversationId],
    );
    const rows = result.rows ?? [];
    if (rows.length > 1) return null;
    return rows[0]?.member_id ?? null;
  }
}
