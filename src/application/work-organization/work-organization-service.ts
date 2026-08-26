import { randomUUID } from 'node:crypto';

import type { AccessContext } from '../../domain/access-context.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { WorkOrganizationRepository } from '../ports/work-organization-repository.js';
import type { WorkIdentityApi } from '../work/work-identity-api.js';
import {
  WorkBoardColumnNotFoundError,
  WorkBoardNotFoundError,
  WorkItemNotFoundError,
  WorkOrganizationValidationError,
  type LinkedWorkSummary,
  type WorkBoard,
  type WorkBoardColumn,
  type WorkBoardPlacement,
  type WorkBoardSnapshot,
  type WorkItem,
  type WorkItemComment,
  type WorkItemDetail,
  type WorkItemStatus,
  type WorkOrganizationOwnerScope,
} from '../../domain/work-organization/work-organization.js';

export interface WorkOrganizationServiceOptions {
  readonly repository: WorkOrganizationRepository;
  readonly workIdentity: Pick<WorkIdentityApi, 'createWork' | 'findWorkById'>;
  readonly conversations?: Pick<
    ConversationRepository,
    'getConversation' | 'listMessages'
  >;
  readonly workListProjection: (input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly work: any;
  }) => Promise<{
    readonly id: string;
    readonly title: string;
    readonly product_state:
      | 'running'
      | 'needs_you'
      | 'complete'
      | 'problem'
      | 'not_captured';
    readonly latest_run_summary: {
      readonly id: string;
      readonly result_summary: string | null;
    } | null;
  }>;
  readonly now?: () => Date;
}

export interface CreateWorkItemInput {
  readonly accessContext: AccessContext;
  readonly title: string;
  readonly description?: string | null;
  readonly assigneeId?: string | null;
  readonly sourceConversationId?: string | null;
  readonly sourceMessageId?: string | null;
  readonly boardId?: string | null;
  readonly columnId?: string | null;
  readonly position?: number;
}

export interface UpdateWorkItemInput {
  readonly accessContext: AccessContext;
  readonly workItemId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: WorkItemStatus;
  readonly assigneeId?: string | null;
}

export interface PromoteWorkItemInput {
  readonly accessContext: AccessContext;
  readonly workItemId: string;
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly title?: string;
}

export class WorkOrganizationService {
  private readonly repository: WorkOrganizationRepository;
  private readonly workIdentity: WorkOrganizationServiceOptions['workIdentity'];
  private readonly conversations?: WorkOrganizationServiceOptions['conversations'];
  private readonly workListProjection: WorkOrganizationServiceOptions['workListProjection'];
  private readonly now: () => Date;

  public constructor(options: WorkOrganizationServiceOptions) {
    this.repository = options.repository;
    this.workIdentity = options.workIdentity;
    this.conversations = options.conversations;
    this.workListProjection = options.workListProjection;
    this.now = options.now ?? (() => new Date());
  }

  public static ownerFromAccessContext(
    accessContext: AccessContext,
  ): WorkOrganizationOwnerScope {
    return {
      tenantId: accessContext.tenantId,
      workspaceId: accessContext.workspaceId,
    };
  }

  public async createWorkItem(input: CreateWorkItemInput): Promise<WorkItemDetail> {
    const owner = WorkOrganizationService.ownerFromAccessContext(input.accessContext);
    validateText(input.title, 1, 200, 'title');
    validateOptionalText(input.description, 16 * 1024, 'description');
    validateOptionalId(input.assigneeId, 'assigneeId');
    await this.validateConversationSource(input);
    const now = this.now().toISOString();
    const workItem = await this.repository.createWorkItem({
      ...owner,
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: 'todo',
      assigneeId: input.assigneeId?.trim() || null,
      createdBy: input.accessContext.principalId,
      sourceConversationId: input.sourceConversationId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      now,
    });
    if (input.boardId || input.columnId) {
      if (!input.boardId || !input.columnId)
        throw new WorkOrganizationValidationError(
          'boardId and columnId must be supplied together.',
        );
      const placement = await this.repository.placeWorkItem({
        ...owner,
        boardId: input.boardId,
        columnId: input.columnId,
        workItemId: workItem.id,
        position: normalizePosition(input.position),
        now,
      });
      if (!placement) throw new WorkBoardColumnNotFoundError();
    }
    return this.hydrateWorkItem(input.accessContext, workItem);
  }

  public async listWorkItems(
    accessContext: AccessContext,
  ): Promise<readonly WorkItemDetail[]> {
    const owner = WorkOrganizationService.ownerFromAccessContext(accessContext);
    const items = await this.repository.listWorkItems(owner);
    return Promise.all(items.map((item) => this.hydrateWorkItem(accessContext, item)));
  }

  public async getWorkItem(
    accessContext: AccessContext,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.repository.findWorkItemById(
      WorkOrganizationService.ownerFromAccessContext(accessContext),
      workItemId,
    );
    if (!item) throw new WorkItemNotFoundError();
    return this.hydrateWorkItem(accessContext, item);
  }

  public async updateWorkItem(input: UpdateWorkItemInput): Promise<WorkItemDetail> {
    if (input.title !== undefined) validateText(input.title, 1, 200, 'title');
    validateOptionalText(input.description, 16 * 1024, 'description');
    validateOptionalId(input.assigneeId, 'assigneeId');
    const item = await this.repository.updateWorkItem({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      id: input.workItemId,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assigneeId !== undefined
        ? { assigneeId: input.assigneeId?.trim() || null }
        : {}),
      now: this.now().toISOString(),
    });
    if (!item) throw new WorkItemNotFoundError();
    return this.hydrateWorkItem(input.accessContext, item);
  }

  public async promoteWorkItem(input: PromoteWorkItemInput): Promise<WorkItemDetail> {
    const owner = WorkOrganizationService.ownerFromAccessContext(input.accessContext);
    return this.repository.withPromotionLock(owner, input.workItemId, async () => {
      const current = await this.repository.findWorkItemById(owner, input.workItemId);
      if (!current) throw new WorkItemNotFoundError();
      if (!current.linkedWorkId) {
        const work = await this.workIdentity.createWork({
          owner,
          accessContext: input.accessContext,
          definitionId: input.definitionId,
          definitionVersionId: input.definitionVersionId,
          title: input.title?.trim() || current.title,
        });
        const linked = await this.repository.linkWork({
          ...owner,
          workItemId: current.id,
          workId: work.id,
          now: this.now().toISOString(),
        });
        if (!linked) throw new WorkItemNotFoundError();
        return this.hydrateWorkItem(input.accessContext, linked);
      }
      return this.hydrateWorkItem(input.accessContext, current);
    });
  }

  public async addComment(input: {
    readonly accessContext: AccessContext;
    readonly workItemId: string;
    readonly body: string;
  }): Promise<WorkItemComment> {
    validateText(input.body, 1, 16 * 1024, 'body');
    const comment = await this.repository.createComment({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      id: randomUUID(),
      workItemId: input.workItemId,
      authorId: input.accessContext.principalId,
      body: input.body.trim(),
      now: this.now().toISOString(),
    });
    if (!comment) throw new WorkItemNotFoundError();
    return comment;
  }

  public async listComments(
    accessContext: AccessContext,
    workItemId: string,
  ): Promise<readonly WorkItemComment[]> {
    const owner = WorkOrganizationService.ownerFromAccessContext(accessContext);
    const item = await this.repository.findWorkItemById(owner, workItemId);
    if (!item) throw new WorkItemNotFoundError();
    return this.repository.listComments(owner, workItemId);
  }

  public async createBoard(input: {
    readonly accessContext: AccessContext;
    readonly title: string;
    readonly description?: string | null;
  }): Promise<WorkBoard> {
    validateText(input.title, 1, 120, 'title');
    validateOptionalText(input.description, 4096, 'description');
    const now = this.now().toISOString();
    return this.repository.createBoard({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      createdBy: input.accessContext.principalId,
      now,
    });
  }

  public listBoards(accessContext: AccessContext): Promise<readonly WorkBoard[]> {
    return this.repository.listBoards(
      WorkOrganizationService.ownerFromAccessContext(accessContext),
    );
  }

  public async updateBoard(input: {
    readonly accessContext: AccessContext;
    readonly boardId: string;
    readonly title?: string;
    readonly description?: string | null;
  }): Promise<WorkBoard> {
    if (input.title !== undefined) validateText(input.title, 1, 120, 'title');
    validateOptionalText(input.description, 4096, 'description');
    const board = await this.repository.updateBoard({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      boardId: input.boardId,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      now: this.now().toISOString(),
    });
    if (!board) throw new WorkBoardNotFoundError();
    return board;
  }

  public async deleteBoard(
    accessContext: AccessContext,
    boardId: string,
  ): Promise<void> {
    const deleted = await this.repository.deleteBoard(
      WorkOrganizationService.ownerFromAccessContext(accessContext),
      boardId,
    );
    if (!deleted) throw new WorkBoardNotFoundError();
  }

  public async getBoard(
    accessContext: AccessContext,
    boardId: string,
  ): Promise<WorkBoardSnapshot> {
    const snapshot = await this.repository.getBoardSnapshot(
      WorkOrganizationService.ownerFromAccessContext(accessContext),
      boardId,
    );
    if (!snapshot) throw new WorkBoardNotFoundError();
    const hydrated = await Promise.all(
      snapshot.workItems.map((item) => this.hydrateWorkItem(accessContext, item)),
    );
    return {
      ...snapshot,
      workItems: hydrated.map((entry) => entry.workItem),
    };
  }

  public async createColumn(input: {
    readonly accessContext: AccessContext;
    readonly boardId: string;
    readonly title: string;
    readonly position?: number;
  }): Promise<WorkBoardColumn> {
    validateText(input.title, 1, 120, 'title');
    const column = await this.repository.createBoardColumn({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      id: randomUUID(),
      boardId: input.boardId,
      title: input.title.trim(),
      position: normalizePosition(input.position),
      now: this.now().toISOString(),
    });
    if (!column) throw new WorkBoardNotFoundError();
    return column;
  }

  public async updateColumn(input: {
    readonly accessContext: AccessContext;
    readonly boardId: string;
    readonly columnId: string;
    readonly title?: string;
    readonly position?: number;
  }): Promise<WorkBoardColumn> {
    if (input.title !== undefined) validateText(input.title, 1, 120, 'title');
    const column = await this.repository.updateBoardColumn({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      boardId: input.boardId,
      columnId: input.columnId,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.position !== undefined
        ? { position: normalizePosition(input.position) }
        : {}),
      now: this.now().toISOString(),
    });
    if (!column) throw new WorkBoardColumnNotFoundError();
    return column;
  }

  public async deleteColumn(input: {
    readonly accessContext: AccessContext;
    readonly boardId: string;
    readonly columnId: string;
  }): Promise<void> {
    const deleted = await this.repository.deleteBoardColumn({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      boardId: input.boardId,
      columnId: input.columnId,
    });
    if (!deleted) throw new WorkBoardColumnNotFoundError();
  }

  public async placeWorkItem(input: {
    readonly accessContext: AccessContext;
    readonly boardId: string;
    readonly columnId: string;
    readonly workItemId: string;
    readonly position?: number;
  }): Promise<WorkBoardPlacement> {
    const placement = await this.repository.placeWorkItem({
      ...WorkOrganizationService.ownerFromAccessContext(input.accessContext),
      boardId: input.boardId,
      columnId: input.columnId,
      workItemId: input.workItemId,
      position: normalizePosition(input.position),
      now: this.now().toISOString(),
    });
    if (!placement) throw new WorkBoardColumnNotFoundError();
    return placement;
  }

  private async hydrateWorkItem(
    accessContext: AccessContext,
    item: WorkItem,
  ): Promise<WorkItemDetail> {
    if (!item.linkedWorkId) return { workItem: item, linkedWork: null };
    const owner = WorkOrganizationService.ownerFromAccessContext(accessContext);
    const work = await this.workIdentity.findWorkById(item.linkedWorkId, owner);
    if (!work) return { workItem: item, linkedWork: null };
    const projection = await this.workListProjection({
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      work,
    });
    let projectedItem = item;
    if (
      projection.product_state === 'complete' &&
      item.status !== 'in_review' &&
      item.status !== 'done'
    ) {
      projectedItem =
        (await this.repository.updateWorkItem({
          ...owner,
          id: item.id,
          status: 'in_review',
          now: this.now().toISOString(),
        })) ?? item;
    }
    const linkedWork: LinkedWorkSummary = {
      workId: projection.id,
      title: projection.title,
      productState: projection.product_state,
      latestWorkRunId: projection.latest_run_summary?.id ?? null,
      resultSummary: projection.latest_run_summary?.result_summary ?? null,
    };
    return { workItem: projectedItem, linkedWork };
  }

  private async validateConversationSource(input: CreateWorkItemInput): Promise<void> {
    const conversationId = input.sourceConversationId ?? null;
    const messageId = input.sourceMessageId ?? null;
    if ((conversationId === null) !== (messageId === null))
      throw new WorkOrganizationValidationError(
        'sourceConversationId and sourceMessageId must be supplied together.',
      );
    if (!conversationId || !messageId) return;
    if (!this.conversations)
      throw new WorkOrganizationValidationError(
        'Conversation-backed WorkItems are unavailable.',
      );
    const conversation = await this.conversations.getConversation({
      tenantId: input.accessContext.tenantId,
      conversationId,
      requesterMemberType: 'principal',
      requesterMemberId: input.accessContext.principalId,
    });
    if (!conversation)
      throw new WorkOrganizationValidationError(
        'The source conversation is not available to the requester.',
      );
    const messages = await this.conversations.listMessages({
      tenantId: input.accessContext.tenantId,
      conversationId,
    });
    if (!messages.some((message) => message.id === messageId))
      throw new WorkOrganizationValidationError(
        'The source message is not persisted in the requested conversation.',
      );
  }
}

function normalizePosition(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000)
    throw new WorkOrganizationValidationError('position must be a non-negative integer.');
  return value;
}

function validateText(
  value: string,
  min: number,
  max: number,
  field: string,
): void {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max)
    throw new WorkOrganizationValidationError(
      `${field} must contain between ${min} and ${max} characters.`,
    );
}

function validateOptionalText(
  value: string | null | undefined,
  max: number,
  field: string,
): void {
  if (value === undefined || value === null) return;
  if (value.trim().length > max)
    throw new WorkOrganizationValidationError(`${field} is too long.`);
}

function validateOptionalId(
  value: string | null | undefined,
  field: string,
): void {
  if (value === undefined || value === null) return;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256)
    throw new WorkOrganizationValidationError(`${field} is invalid.`);
}
