import type {
  ClaimWorkItemRecordInput,
  ClaimWorkItemRecordResult,
  CreateBoardColumnRecordInput,
  CreateBoardRecordInput,
  CreateWorkItemRecordInput,
  UpdateWorkItemRecordInput,
  WorkItemPlacementSummary,
  WorkOrganizationRepository,
} from '../../application/ports/work-organization-repository.js';
import {
  claimTargetColumn,
  isWorkBoardColumnKind,
} from '../../domain/work-organization/board-column-kinds.js';
import type {
  WorkBoard,
  WorkBoardColumn,
  WorkBoardPlacement,
  WorkBoardSnapshot,
  WorkItem,
  WorkItemComment,
  WorkOrganizationOwnerScope,
} from '../../domain/work-organization/work-organization.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

type WorkItemRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: WorkItem['status'];
  assignee_id: string | null;
  mentions: unknown;
  created_by: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  linked_work_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type CommentRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  work_item_id: string;
  author_id: string;
  body: string;
  mentions: unknown;
  created_at: string | Date;
};

type BoardRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type ColumnRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  board_id: string;
  title: string;
  position: number;
  kind: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type PlacementRow = {
  tenant_id: string;
  workspace_id: string;
  board_id: string;
  column_id: string;
  work_item_id: string;
  position: number;
  created_at: string | Date;
  updated_at: string | Date;
};

export class PostgresWorkOrganizationRepository implements WorkOrganizationRepository {
  private readonly promotionQueues = new Map<string, Promise<void>>();

  public constructor(private readonly db: Queryable) {}

  public async createWorkItem(
    input: CreateWorkItemRecordInput,
  ): Promise<WorkItem> {
    const result = await this.db.query<WorkItemRow>(
      `INSERT INTO product_work_items
        (id,tenant_id,workspace_id,title,description,status,assignee_id,mentions,created_by,
         source_conversation_id,source_message_id,linked_work_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,NULL,$12,$12)
       RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.workspaceId,
        input.title,
        input.description,
        input.status,
        input.assigneeId,
        JSON.stringify(input.mentions),
        input.createdBy,
        input.sourceConversationId,
        input.sourceMessageId,
        input.now,
      ],
    );
    return mapWorkItem(requireRow(result.rows));
  }

  public async findWorkItemById(
    owner: WorkOrganizationOwnerScope,
    id: string,
  ): Promise<WorkItem | null> {
    const result = await this.db.query<WorkItemRow>(
      `SELECT * FROM product_work_items
        WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      [owner.tenantId, owner.workspaceId, id],
    );
    const row = result.rows?.[0];
    return row ? mapWorkItem(row) : null;
  }

  public async listWorkItems(
    owner: WorkOrganizationOwnerScope,
  ): Promise<readonly WorkItem[]> {
    const result = await this.db.query<WorkItemRow>(
      `SELECT * FROM product_work_items
        WHERE tenant_id=$1 AND workspace_id=$2
        ORDER BY updated_at DESC,id ASC`,
      [owner.tenantId, owner.workspaceId],
    );
    return Object.freeze((result.rows ?? []).map(mapWorkItem));
  }

  public async updateWorkItem(
    input: UpdateWorkItemRecordInput,
  ): Promise<WorkItem | null> {
    const result = await this.db.query<WorkItemRow>(
      `UPDATE product_work_items SET
         title=COALESCE($4,title),
         description=CASE WHEN $5::boolean THEN $6 ELSE description END,
         status=COALESCE($7,status),
         assignee_id=CASE WHEN $8::boolean THEN $9 ELSE assignee_id END,
         mentions=COALESCE($10::jsonb,mentions),
         updated_at=$11
       WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3
       RETURNING *`,
      [
        input.tenantId,
        input.workspaceId,
        input.id,
        input.title ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.status ?? null,
        input.assigneeId !== undefined,
        input.assigneeId ?? null,
        input.mentions ? JSON.stringify(input.mentions) : null,
        input.now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapWorkItem(row) : null;
  }

  public async claimWorkItem(
    input: ClaimWorkItemRecordInput,
  ): Promise<ClaimWorkItemRecordResult> {
    // Where the WorkItem sits and what its board's columns MEAN is read first,
    // because the advance decision belongs to the pure domain rule rather than
    // to SQL. Nothing is decided by this read: the move below re-checks the
    // column it saw, so a concurrent drag loses the move, never the claim.
    const placement = await this.findWorkItemPlacement(input, input.workItemId);
    const advanceTo = placement
      ? claimTargetColumn({
          columns: (await this.listBoardColumns(input, placement.boardId)).map(
            (column) => ({
              id: column.id,
              position: column.position,
              kind: column.kind,
            }),
          ),
          currentColumnId: placement.columnId,
        })
      : null;

    // ONE statement, so it is ONE implicit transaction. The `claimed` CTE is the
    // only source of truth: it either matched a row or it did not, and no
    // SELECT-then-UPDATE window exists for a second claimant to slip through.
    const result = await this.db.query<
      WorkItemRow & { moved_to_column_id: string | null }
    >(
      `WITH claimed AS (
         UPDATE product_work_items
            SET assignee_id=$4,updated_at=$5
          WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3
            AND (assignee_id IS NULL
                 OR assignee_id=$4
                 OR updated_at < $5::timestamptz - make_interval(mins => $6::int))
          RETURNING *
       ), moved AS (
         UPDATE product_work_board_placements
            SET column_id=$8,updated_at=$5
          WHERE $7::boolean
            AND tenant_id=$1 AND workspace_id=$2 AND work_item_id=$3
            AND column_id=$9
            AND EXISTS (SELECT 1 FROM claimed)
          RETURNING column_id
       )
       SELECT claimed.*,(SELECT column_id FROM moved) AS moved_to_column_id
         FROM claimed`,
      [
        input.tenantId,
        input.workspaceId,
        input.workItemId,
        input.claimantId,
        input.now,
        input.staleAfterMinutes,
        advanceTo !== null,
        advanceTo ?? placement?.columnId ?? null,
        placement?.columnId ?? null,
      ],
    );
    const row = result.rows?.[0];
    if (row)
      return Object.freeze({
        workItem: mapWorkItem(row),
        holderId: row.assignee_id,
        movedToColumnId: row.moved_to_column_id,
      });

    // The claim lost. Reading the holder afterwards is only for the message the
    // loser gets, so a stale read here cannot corrupt anything.
    const current = await this.findWorkItemById(input, input.workItemId);
    return Object.freeze({
      workItem: null,
      holderId: current?.assigneeId ?? null,
      movedToColumnId: null,
    });
  }

  public async findWorkItemPlacement(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
  ): Promise<WorkItemPlacementSummary | null> {
    const result = await this.db.query<PlacementRow>(
      `SELECT * FROM product_work_board_placements
        WHERE tenant_id=$1 AND workspace_id=$2 AND work_item_id=$3`,
      [owner.tenantId, owner.workspaceId, workItemId],
    );
    const row = result.rows?.[0];
    return row
      ? Object.freeze({
          boardId: row.board_id,
          columnId: row.column_id,
          position: Number(row.position),
        })
      : null;
  }

  public async linkWork(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workItemId: string;
    readonly workId: string;
    readonly now: string;
  }): Promise<WorkItem | null> {
    const result = await this.db.query<WorkItemRow>(
      `UPDATE product_work_items
          SET linked_work_id=COALESCE(linked_work_id,$4),updated_at=$5
        WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3
        RETURNING *`,
      [
        input.tenantId,
        input.workspaceId,
        input.workItemId,
        input.workId,
        input.now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapWorkItem(row) : null;
  }

  public async withPromotionLock<T>(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    // Promotion is serialized inside the application process. The durable
    // linked_work_id uniqueness constraint is the final guard; this MVE does
    // not claim multi-host promotion recovery.
    const key = `${owner.tenantId}:${owner.workspaceId}:${workItemId}`;
    const prior = this.promotionQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(() => gate);
    this.promotionQueues.set(key, queued);
    await prior;
    try {
      return await callback();
    } finally {
      release();
      if (this.promotionQueues.get(key) === queued)
        this.promotionQueues.delete(key);
    }
  }

  public async createComment(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workItemId: string;
    readonly authorId: string;
    readonly body: string;
    readonly mentions: readonly string[];
    readonly now: string;
  }): Promise<WorkItemComment | null> {
    const result = await this.db.query<CommentRow>(
      `INSERT INTO product_work_item_comments
        (id,tenant_id,workspace_id,work_item_id,author_id,body,mentions,created_at)
       SELECT $1,$2,$3,w.id,$5,$6,$7::jsonb,$8
         FROM product_work_items w
        WHERE w.tenant_id=$2 AND w.workspace_id=$3 AND w.id=$4
       RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.workspaceId,
        input.workItemId,
        input.authorId,
        input.body,
        JSON.stringify(input.mentions),
        input.now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapComment(row) : null;
  }

  public async listComments(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
  ): Promise<readonly WorkItemComment[]> {
    const result = await this.db.query<CommentRow>(
      `SELECT c.* FROM product_work_item_comments c
        JOIN product_work_items w ON w.id=c.work_item_id
       WHERE c.tenant_id=$1 AND c.workspace_id=$2 AND c.work_item_id=$3
         AND w.tenant_id=$1 AND w.workspace_id=$2
       ORDER BY c.created_at ASC,c.id ASC`,
      [owner.tenantId, owner.workspaceId, workItemId],
    );
    return Object.freeze((result.rows ?? []).map(mapComment));
  }

  public async createBoard(input: CreateBoardRecordInput): Promise<WorkBoard> {
    const result = await this.db.query<BoardRow>(
      `INSERT INTO product_work_boards
        (id,tenant_id,workspace_id,title,description,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.workspaceId,
        input.title,
        input.description,
        input.createdBy,
        input.now,
      ],
    );
    return mapBoard(requireRow(result.rows));
  }

  public async findBoardById(
    owner: WorkOrganizationOwnerScope,
    id: string,
  ): Promise<WorkBoard | null> {
    const result = await this.db.query<BoardRow>(
      `SELECT * FROM product_work_boards
        WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      [owner.tenantId, owner.workspaceId, id],
    );
    const row = result.rows?.[0];
    return row ? mapBoard(row) : null;
  }

  public async listBoards(
    owner: WorkOrganizationOwnerScope,
  ): Promise<readonly WorkBoard[]> {
    const result = await this.db.query<BoardRow>(
      `SELECT * FROM product_work_boards
        WHERE tenant_id=$1 AND workspace_id=$2
        ORDER BY updated_at DESC,id ASC`,
      [owner.tenantId, owner.workspaceId],
    );
    return Object.freeze((result.rows ?? []).map(mapBoard));
  }

  public async updateBoard(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly title?: string;
    readonly description?: string | null;
    readonly now: string;
  }): Promise<WorkBoard | null> {
    const result = await this.db.query<BoardRow>(
      `UPDATE product_work_boards SET
         title=COALESCE($4,title),
         description=CASE WHEN $5::boolean THEN $6 ELSE description END,
         updated_at=$7
       WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3
       RETURNING *`,
      [
        input.tenantId,
        input.workspaceId,
        input.boardId,
        input.title ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapBoard(row) : null;
  }

  public async deleteBoard(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM product_work_boards
        WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      [owner.tenantId, owner.workspaceId, boardId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async createBoardColumn(
    input: CreateBoardColumnRecordInput,
  ): Promise<WorkBoardColumn | null> {
    const result = await this.db.query<ColumnRow>(
      `INSERT INTO product_work_board_columns
        (id,tenant_id,workspace_id,board_id,title,position,kind,created_at,updated_at)
       SELECT $1,$2,$3,b.id,$5,$6,$7,$8,$8
         FROM product_work_boards b
        WHERE b.tenant_id=$2 AND b.workspace_id=$3 AND b.id=$4
       RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.workspaceId,
        input.boardId,
        input.title,
        input.position,
        input.kind,
        input.now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapColumn(row) : null;
  }

  public async updateBoardColumn(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
    readonly title?: string;
    readonly position?: number;
    readonly kind?: WorkBoardColumn['kind'];
    readonly now: string;
  }): Promise<WorkBoardColumn | null> {
    const result = await this.db.query<ColumnRow>(
      `UPDATE product_work_board_columns SET
         title=COALESCE($5,title),
         position=COALESCE($6,position),
         kind=CASE WHEN $7::boolean THEN $8 ELSE kind END,
         updated_at=$9
       WHERE tenant_id=$1 AND workspace_id=$2 AND board_id=$3 AND id=$4
       RETURNING *`,
      [
        input.tenantId,
        input.workspaceId,
        input.boardId,
        input.columnId,
        input.title ?? null,
        input.position ?? null,
        input.kind !== undefined,
        input.kind ?? null,
        input.now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapColumn(row) : null;
  }

  public async listBoardColumns(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<readonly WorkBoardColumn[]> {
    const result = await this.db.query<ColumnRow>(
      `SELECT * FROM product_work_board_columns
        WHERE tenant_id=$1 AND workspace_id=$2 AND board_id=$3
        ORDER BY position ASC,created_at ASC,id ASC`,
      [owner.tenantId, owner.workspaceId, boardId],
    );
    return Object.freeze((result.rows ?? []).map(mapColumn));
  }

  public async deleteBoardColumn(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
  }): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM product_work_board_columns
        WHERE tenant_id=$1 AND workspace_id=$2 AND board_id=$3 AND id=$4`,
      [input.tenantId, input.workspaceId, input.boardId, input.columnId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async placeWorkItem(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
    readonly workItemId: string;
    readonly position: number;
    readonly now: string;
  }): Promise<WorkBoardPlacement | null> {
    const result = await this.db.query<PlacementRow>(
      `INSERT INTO product_work_board_placements
        (tenant_id,workspace_id,board_id,column_id,work_item_id,position,created_at,updated_at)
       SELECT $1,$2,b.id,c.id,w.id,$6,$7,$7
         FROM product_work_boards b
         JOIN product_work_board_columns c ON c.board_id=b.id AND c.id=$4
         JOIN product_work_items w ON w.id=$5
        WHERE b.tenant_id=$1 AND b.workspace_id=$2
          AND c.tenant_id=$1 AND c.workspace_id=$2
          AND w.tenant_id=$1 AND w.workspace_id=$2
          AND b.id=$3
       ON CONFLICT (work_item_id) DO UPDATE SET
         board_id=EXCLUDED.board_id,
         column_id=EXCLUDED.column_id,
         position=EXCLUDED.position,
         updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [
        input.tenantId,
        input.workspaceId,
        input.boardId,
        input.columnId,
        input.workItemId,
        input.position,
        input.now,
      ],
    );
    const row = result.rows?.[0];
    return row ? mapPlacement(row) : null;
  }

  public async getBoardSnapshot(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<WorkBoardSnapshot | null> {
    const board = await this.findBoardById(owner, boardId);
    if (!board) return null;
    const [columnsResult, placementsResult, workItemsResult] =
      await Promise.all([
        this.db.query<ColumnRow>(
          `SELECT * FROM product_work_board_columns
          WHERE tenant_id=$1 AND workspace_id=$2 AND board_id=$3
          ORDER BY position ASC,created_at ASC,id ASC`,
          [owner.tenantId, owner.workspaceId, boardId],
        ),
        this.db.query<PlacementRow>(
          `SELECT * FROM product_work_board_placements
          WHERE tenant_id=$1 AND workspace_id=$2 AND board_id=$3
          ORDER BY column_id,position ASC,created_at ASC,work_item_id ASC`,
          [owner.tenantId, owner.workspaceId, boardId],
        ),
        this.db.query<WorkItemRow>(
          `SELECT w.* FROM product_work_items w
          JOIN product_work_board_placements p ON p.work_item_id=w.id
         WHERE p.tenant_id=$1 AND p.workspace_id=$2 AND p.board_id=$3
           AND w.tenant_id=$1 AND w.workspace_id=$2
         ORDER BY p.position ASC,w.created_at ASC,w.id ASC`,
          [owner.tenantId, owner.workspaceId, boardId],
        ),
      ]);
    return Object.freeze({
      board,
      columns: Object.freeze((columnsResult.rows ?? []).map(mapColumn)),
      placements: Object.freeze(
        (placementsResult.rows ?? []).map(mapPlacement),
      ),
      workItems: Object.freeze((workItemsResult.rows ?? []).map(mapWorkItem)),
    });
  }
}

function requireRow<T>(rows: readonly T[] | undefined): T {
  const row = rows?.[0];
  if (!row) throw new Error('Expected the persistence write to return a row.');
  return row;
}

function mapWorkItem(row: WorkItemRow): WorkItem {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeId: row.assignee_id,
    mentions: toMentions(row.mentions),
    createdBy: row.created_by,
    sourceConversationId: row.source_conversation_id,
    sourceMessageId: row.source_message_id,
    linkedWorkId: row.linked_work_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapComment(row: CommentRow): WorkItemComment {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    workItemId: row.work_item_id,
    authorId: row.author_id,
    body: row.body,
    mentions: toMentions(row.mentions),
    createdAt: toIso(row.created_at),
  });
}

/**
 * A jsonb column arrives either already parsed (node-postgres) or as text
 * (some drivers), and rows written before the migration read as '[]'. Anything
 * that is not an array of strings is dropped rather than trusted: a malformed
 * mentions payload must not be able to wake an agent.
 */
function toMentions(value: unknown): readonly string[] {
  const parsed = typeof value === 'string' ? safeParseJson(value) : value;
  if (!Array.isArray(parsed)) return Object.freeze([]);
  return Object.freeze(
    parsed.filter((entry): entry is string => typeof entry === 'string'),
  );
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapBoard(row: BoardRow): WorkBoard {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapColumn(row: ColumnRow): WorkBoardColumn {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    boardId: row.board_id,
    title: row.title,
    position: Number(row.position),
    kind: isWorkBoardColumnKind(row.kind) ? row.kind : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapPlacement(row: PlacementRow): WorkBoardPlacement {
  return Object.freeze({
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    boardId: row.board_id,
    columnId: row.column_id,
    workItemId: row.work_item_id,
    position: Number(row.position),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
