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
  readonly now: string;
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
  readonly now: string;
}

export interface WorkOrganizationRepository {
  createWorkItem(input: CreateWorkItemRecordInput): Promise<WorkItem>;
  findWorkItemById(
    owner: WorkOrganizationOwnerScope,
    id: string,
  ): Promise<WorkItem | null>;
  listWorkItems(owner: WorkOrganizationOwnerScope): Promise<readonly WorkItem[]>;
  updateWorkItem(input: UpdateWorkItemRecordInput): Promise<WorkItem | null>;
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
  deleteBoard(owner: WorkOrganizationOwnerScope, boardId: string): Promise<boolean>;

  createBoardColumn(input: CreateBoardColumnRecordInput): Promise<WorkBoardColumn | null>;
  updateBoardColumn(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
    readonly title?: string;
    readonly position?: number;
    readonly now: string;
  }): Promise<WorkBoardColumn | null>;
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
