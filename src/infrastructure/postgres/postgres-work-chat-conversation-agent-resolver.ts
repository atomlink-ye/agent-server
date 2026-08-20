import type { WorkChatConversationAgentDefinitionResolver } from '../../application/work-chat/work-chat-wake-delivery.js';
import type { PostgresQueryable } from './postgres-conversation-repository.js';

type AgentMemberRow = {
  member_id: string;
};

/**
 * Production source for the agent identity used by a Work Chat wake. The
 * conversation must be the tenant/workspace/work-scoped link target; the
 * append adapter still performs the authoritative membership check in its
 * write transaction.
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
      `SELECT members.member_id
       FROM conversation_work_links AS links
       JOIN conversation_members AS members
         ON members.tenant_id=links.tenant_id
        AND members.conversation_id=links.conversation_id
        AND members.member_type='agent_definition'
       WHERE links.tenant_id=$1
         AND links.workspace_id=$2
         AND links.work_id=$3
         AND links.conversation_id=$4
       ORDER BY members.member_id
       LIMIT 2`,
      [input.tenantId, input.workspaceId, input.workId, input.conversationId],
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
