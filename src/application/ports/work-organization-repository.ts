import type { WorkBoardColumnKind } from '../../domain/work-organization/board-column-kinds.js';
import type {
  WorkBoard,
  WorkBoardColumn,
  WorkBoardPlacement,
  WorkBoardSnapshot,
  WorkItem,
  WorkItemComment,
  WorkItemStatus,
  WorkOrganizationOwnerScope,
} from '../../domain/work-organization/work-organization.js';

export interface CreateWorkItemRecordInput extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: WorkItemStatus;
  readonly assigneeId: string | null;
  readonly mentions: readonly string[];
  readonly createdBy: string;
  readonly sourceConversationId: string | null;
  readonly sourceMessageId: string | null;
  readonly now: string;
}

export interface UpdateWorkItemRecordInput extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: WorkItemStatus;
  readonly assigneeId?: string | null;
  readonly mentions?: readonly string[];
  readonly now: string;
}

/** Where a WorkItem currently sits, when it sits on a board at all. */
export interface WorkItemPlacementSummary {
  readonly boardId: string;
  readonly columnId: string;
  readonly position: number;
}

export interface ClaimWorkItemRecordInput extends WorkOrganizationOwnerScope {
  readonly workItemId: string;
  readonly claimantId: string;
  /**
   * How long a claim survives without an update before another claimant may
   * take it. This is the stale-claim escape hatch: without it a crashed agent
   * would hold a WorkItem forever.
   */
  readonly staleAfterMinutes: number;
  readonly now: string;
}

export interface ClaimWorkItemRecordResult {
  /** The claimed row, or null when the atomic UPDATE matched no row. */
  readonly workItem: WorkItem | null;
  /** Who holds it instead; only meaningful when `workItem` is null. */
  readonly holderId: string | null;
  /** The column the claim advanced it into, when it advanced at all. */
  readonly movedToColumnId: string | null;
}

export interface CreateBoardRecordInput extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly createdBy: string;
  readonly now: string;
}

export interface CreateBoardColumnRecordInput extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly position: number;
  readonly kind: WorkBoardColumnKind | null;
  readonly now: string;
}

export interface WorkOrganizationRepository {
  createWorkItem(input: CreateWorkItemRecordInput): Promise<WorkItem>;
  findWorkItemById(
    owner: WorkOrganizationOwnerScope,
    id: string,
  ): Promise<WorkItem | null>;
  listWorkItems(
    owner: WorkOrganizationOwnerScope,
  ): Promise<readonly WorkItem[]>;
  updateWorkItem(input: UpdateWorkItemRecordInput): Promise<WorkItem | null>;
  /**
   * Take ownership of a WorkItem if and only if nobody else holds it, in ONE
   * statement. The row count of that statement is the only success signal —
   * a SELECT-then-UPDATE would let two claimants both read "unassigned".
   *
   * When the claim lands and the WorkItem sits in a column declared 'todo' on a
   * board that also declares a 'doing' column, the same call advances it.
   */
  claimWorkItem(
    input: ClaimWorkItemRecordInput,
  ): Promise<ClaimWorkItemRecordResult>;
  findWorkItemPlacement(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
  ): Promise<WorkItemPlacementSummary | null>;
  linkWork(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workItemId: string;
    readonly workId: string;
    readonly now: string;
  }): Promise<WorkItem | null>;
  withPromotionLock<T>(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
    callback: () => Promise<T>,
  ): Promise<T>;

  createComment(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workItemId: string;
    readonly authorId: string;
    readonly body: string;
    readonly mentions: readonly string[];
    readonly now: string;
  }): Promise<WorkItemComment | null>;
  listComments(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
  ): Promise<readonly WorkItemComment[]>;

  createBoard(input: CreateBoardRecordInput): Promise<WorkBoard>;
  findBoardById(
    owner: WorkOrganizationOwnerScope,
    id: string,
  ): Promise<WorkBoard | null>;
  listBoards(owner: WorkOrganizationOwnerScope): Promise<readonly WorkBoard[]>;
  updateBoard(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly title?: string;
    readonly description?: string | null;
    readonly now: string;
  }): Promise<WorkBoard | null>;
  deleteBoard(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<boolean>;

  createBoardColumn(
    input: CreateBoardColumnRecordInput,
  ): Promise<WorkBoardColumn | null>;
  updateBoardColumn(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
    readonly title?: string;
    readonly position?: number;
    readonly kind?: WorkBoardColumnKind | null;
    readonly now: string;
  }): Promise<WorkBoardColumn | null>;
  listBoardColumns(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<readonly WorkBoardColumn[]>;
  deleteBoardColumn(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
  }): Promise<boolean>;

  placeWorkItem(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
    readonly workItemId: string;
    readonly position: number;
    readonly now: string;
  }): Promise<WorkBoardPlacement | null>;
  getBoardSnapshot(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<WorkBoardSnapshot | null>;
}
