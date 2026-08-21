import type {
  ConversationWorkLink,
  ConversationWorkLinkRepository,
} from '../../domain/chat/chat-work-origin-ref.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

type ConversationWorkLinkRow = {
  tenant_id: string;
  workspace_id: string;
  work_id: string;
  conversation_id: string;
  trigger_message_id: string | null;
  created_at: string | Date;
};

const LINK_COLUMNS =
  'tenant_id,workspace_id,work_id,conversation_id,trigger_message_id,created_at';
const FIND_CONVERSATION_ID_SQL =
  'SELECT conversation_id FROM conversation_work_links WHERE work_id=$1 AND tenant_id=$2 AND workspace_id=$3';

/** PostgreSQL adapter for the tenant/workspace-scoped conversation link seam. */
export class PostgresConversationWorkLinkRepository implements ConversationWorkLinkRepository {
  public constructor(private readonly database: Queryable) {}

  public async linkWorkToConversation(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
    readonly conversationId: string;
    readonly triggerMessageId: string;
  }): Promise<ConversationWorkLink> {
    const inserted = await this.database.query<ConversationWorkLinkRow>(
      `INSERT INTO conversation_work_links
         (tenant_id,workspace_id,work_id,conversation_id,trigger_message_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id,workspace_id,work_id) DO NOTHING
       RETURNING ${LINK_COLUMNS}`,
      [
        input.tenantId,
        input.workspaceId,
        input.workId,
        input.conversationId,
        input.triggerMessageId,
        new Date().toISOString(),
      ],
    );

    const row = inserted.rows?.[0] ?? (await this.findLink(input));
    if (!row)
      throw new Error(
        'Failed to create or retrieve the conversation work link.',
      );
    if (row.conversation_id !== input.conversationId)
      throw new Error('The Work is already linked to another conversation.');
    return mapLink(row);
  }

  public async findConversationIdByWork(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
  }): Promise<string | null> {
    const result = await this.database.query<{ conversation_id: string }>(
      FIND_CONVERSATION_ID_SQL,
      [input.workId, input.tenantId, input.workspaceId],
    );
    return result.rows?.[0]?.conversation_id ?? null;
  }

  public async findRecentWorkByConversation(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly limit?: number;
  }): Promise<readonly ConversationWorkLink[]> {
    const limit = Math.max(1, Math.min(100, input.limit ?? 20));
    const result = await this.database.query<ConversationWorkLinkRow>(
      `SELECT ${LINK_COLUMNS}
       FROM conversation_work_links
       WHERE tenant_id=$1 AND workspace_id=$2 AND conversation_id=$3
       ORDER BY created_at DESC,work_id DESC
       LIMIT $4`,
      [input.tenantId, input.workspaceId, input.conversationId, limit],
    );
    return (result.rows ?? []).map(mapLink);
  }

  public async findWorkIdsByOrigin(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly triggerMessageId: string;
  }): Promise<readonly string[]> {
    const result = await this.database.query<{ work_id: string }>(
      `SELECT work_id
       FROM conversation_work_links
       WHERE tenant_id=$1 AND conversation_id=$2 AND trigger_message_id=$3
       ORDER BY work_id ASC`,
      [input.tenantId, input.conversationId, input.triggerMessageId],
    );
    return (result.rows ?? []).map((row) => row.work_id);
  }

  private async findLink(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
  }): Promise<ConversationWorkLinkRow | null> {
    const result = await this.database.query<ConversationWorkLinkRow>(
      `SELECT ${LINK_COLUMNS}
       FROM conversation_work_links
       WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3`,
      [input.tenantId, input.workspaceId, input.workId],
    );
    return result.rows?.[0] ?? null;
  }
}

function mapLink(row: ConversationWorkLinkRow): ConversationWorkLink {
  return Object.freeze({
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    workId: row.work_id,
    conversationId: row.conversation_id,
    triggerMessageId: row.trigger_message_id ?? null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  });
}
