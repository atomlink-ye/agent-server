export const WORK_ITEM_STATUSES = [
  'todo',
  'in_progress',
  'in_review',
  'done',
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export interface WorkOrganizationOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface WorkItem extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: WorkItemStatus;
  readonly assigneeId: string | null;
  readonly createdBy: string;
  readonly sourceConversationId: string | null;
  readonly sourceMessageId: string | null;
  readonly linkedWorkId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkItemComment extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly workItemId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
}

/** Product coordination board. This is intentionally distinct from the
 * execution-time collaboration board used inside TeamRun orchestration. */
export interface WorkBoard extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkBoardColumn extends WorkOrganizationOwnerScope {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkBoardPlacement extends WorkOrganizationOwnerScope {
  readonly boardId: string;
  readonly columnId: string;
  readonly workItemId: string;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkBoardSnapshot {
  readonly board: WorkBoard;
  readonly columns: readonly WorkBoardColumn[];
  readonly placements: readonly WorkBoardPlacement[];
  readonly workItems: readonly WorkItem[];
}

export interface LinkedWorkSummary {
  readonly workId: string;
  readonly title: string;
  readonly productState:
    'running' | 'needs_you' | 'complete' | 'problem' | 'not_captured';
  readonly latestWorkRunId: string | null;
  readonly resultSummary: string | null;
}

export interface WorkItemDetail {
  readonly workItem: WorkItem;
  readonly linkedWork: LinkedWorkSummary | null;
}

export function isWorkItemStatus(value: string): value is WorkItemStatus {
  return (WORK_ITEM_STATUSES as readonly string[]).includes(value);
}

export class WorkItemNotFoundError extends Error {
  public readonly code = WORK_ITEM_NOT_FOUND_CODE;
  public constructor() {
    super('The requested WorkItem was not found.');
    this.name = 'WorkItemNotFoundError';
  }
}

export class WorkBoardNotFoundError extends Error {
  public readonly code = WORK_BOARD_NOT_FOUND_CODE;
  public constructor() {
    super('The requested Board was not found.');
    this.name = 'WorkBoardNotFoundError';
  }
}

export class WorkBoardColumnNotFoundError extends Error {
  public readonly code = 'work_board_column_not_found';
  public constructor() {
    super('The requested Board column was not found.');
    this.name = 'WorkBoardColumnNotFoundError';
  }
}

export class WorkOrganizationValidationError extends Error {
  public readonly code = 'work_organization_invalid';
  public constructor(
    message = 'The requested work-organization change is invalid.',
  ) {
    super(message);
    this.name = 'WorkOrganizationValidationError';
  }
}
import {
  WORK_BOARD_NOT_FOUND_CODE,
  WORK_ITEM_NOT_FOUND_CODE,
} from '../../contracts/work-organization.js';
