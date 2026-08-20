import type { WorkChatWakeWorkSource } from '../../application/work-chat/work-chat-wake-worker.js';
import type {
  WorkChatWakeCursor,
  WorkChatWakeWorkKey,
  WorkChatWakeWorkPage,
} from '../../application/work-chat/work-chat-wake-state-repository.js';

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

  public async listWorkKeys(input: {
    readonly cursor: WorkChatWakeCursor | null;
    readonly limit: number;
  }): Promise<WorkChatWakeWorkPage> {
    const limit = Number.isFinite(input.limit)
      ? Math.max(1, Math.min(100, Math.trunc(input.limit)))
      : 50;
    const result = await this.database.query<WorkKeyRow>(
      `SELECT tenant_id, workspace_id, work_id
       FROM conversation_work_links
       WHERE ($1::text IS NULL OR
         (tenant_id, workspace_id, work_id) >
         ($1::text, $2::uuid, $3::uuid))
       ORDER BY tenant_id, workspace_id, work_id
       LIMIT $4`,
      [
        input.cursor?.tenantId ?? null,
        input.cursor?.workspaceId ?? null,
        input.cursor?.workId ?? null,
        limit,
      ],
    );
    const items: readonly WorkChatWakeWorkKey[] = (result.rows ?? []).map(
      (row) => ({
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        workId: row.work_id,
      }),
    );
    const last = items.at(-1) ?? null;
    return {
      items,
      nextCursor: items.length === limit ? last : null,
    };
  }
}
