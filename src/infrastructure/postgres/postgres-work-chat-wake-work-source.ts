import type { WorkChatWakeWorkSource } from '../../application/work-chat/work-chat-wake-worker.js';
import type { WorkChatWakeWorkKey } from '../../application/work-chat/work-chat-wake-state-repository.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

type WorkKeyRow = {
  tenant_id: string;
  workspace_id: string;
  work_id: string;
};

/**
 * Production candidate population source. It only enumerates scoped links;
 * point resolution remains the ConversationWorkLinkRepository seam.
 */
export class PostgresWorkChatWakeWorkSource implements WorkChatWakeWorkSource {
  public constructor(private readonly database: Queryable) {}

  public async listWorkKeys(): Promise<readonly WorkChatWakeWorkKey[]> {
    const result = await this.database.query<WorkKeyRow>(
      `SELECT DISTINCT tenant_id, workspace_id, work_id
       FROM conversation_work_links
       ORDER BY tenant_id, workspace_id, work_id`,
    );
    return (result.rows ?? []).map((row) => ({
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      workId: row.work_id,
    }));
  }
}
