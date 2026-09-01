import { describe, expect, it } from 'vitest';

import type {
  ClaimWorkItemRecordInput,
  ClaimWorkItemRecordResult,
  CreateBoardColumnRecordInput,
  CreateBoardRecordInput,
  CreateWorkItemRecordInput,
  UpdateWorkItemRecordInput,
  WorkItemPlacementSummary,
  WorkOrganizationRepository,
} from '../../src/application/ports/work-organization-repository.js';
import {
  WorkOrganizationService,
  type WorkOrganizationServiceOptions,
} from '../../src/application/work-organization/work-organization-service.js';
import type { AccessContext } from '../../src/domain/access-context.js';
import {
  claimTargetColumn,
  type WorkBoardColumnKind,
} from '../../src/domain/work-organization/board-column-kinds.js';
import { createWork, type Work } from '../../src/domain/work/work.js';
import type {
  WorkBoard,
  WorkBoardColumn,
  WorkBoardPlacement,
  WorkBoardSnapshot,
  WorkItem,
  WorkItemComment,
  WorkOrganizationOwnerScope,
} from '../../src/domain/work-organization/work-organization.js';

const accessContext: AccessContext = {
  tenantId: 'tenant-test',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  principalType: 'user',
  principalId: 'human-1',
  policySnapshotVersion: 'test-v1',
};

const conversationId = '00000000-0000-4000-8000-000000000010';
const messageId = '00000000-0000-4000-8000-000000000011';
const definitionId = '00000000-0000-4000-8000-000000000020';
const definitionVersionId = '00000000-0000-4000-8000-000000000021';

class InMemoryWorkOrganizationRepository implements WorkOrganizationRepository {
  public readonly items = new Map<string, WorkItem>();
  public readonly comments = new Map<string, WorkItemComment[]>();
  public readonly boards = new Map<string, WorkBoard>();
  public readonly columns = new Map<string, WorkBoardColumn>();
  public readonly placements = new Map<string, WorkBoardPlacement>();

  public async createWorkItem(
    input: CreateWorkItemRecordInput,
  ): Promise<WorkItem> {
    const item: WorkItem = {
      id: input.id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description,
      status: input.status,
      assigneeId: input.assigneeId,
      mentions: input.mentions,
      createdBy: input.createdBy,
      sourceConversationId: input.sourceConversationId,
      sourceMessageId: input.sourceMessageId,
      linkedWorkId: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.items.set(item.id, item);
    return item;
  }

  public async findWorkItemById(
    owner: WorkOrganizationOwnerScope,
    id: string,
  ): Promise<WorkItem | null> {
    const item = this.items.get(id);
    return item && sameOwner(item, owner) ? item : null;
  }

  public async listWorkItems(
    owner: WorkOrganizationOwnerScope,
  ): Promise<readonly WorkItem[]> {
    return [...this.items.values()].filter((item) => sameOwner(item, owner));
  }

  public async updateWorkItem(
    input: UpdateWorkItemRecordInput,
  ): Promise<WorkItem | null> {
    const current = await this.findWorkItemById(input, input.id);
    if (!current) return null;
    const next: WorkItem = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assigneeId !== undefined
        ? { assigneeId: input.assigneeId }
        : {}),
      ...(input.mentions !== undefined ? { mentions: input.mentions } : {}),
      updatedAt: input.now,
    };
    this.items.set(next.id, next);
    return next;
  }

  /**
   * The in-memory stand-in for the single-statement claim. It is deliberately
   * written as one synchronous block with no await inside, because the property
   * under test is "exactly one claimant wins" — an await between the check and
   * the write would make this fixture lie about the production behaviour.
   */
  public async claimWorkItem(
    input: ClaimWorkItemRecordInput,
  ): Promise<ClaimWorkItemRecordResult> {
    const current = this.items.get(input.workItemId);
    if (!current || !sameOwner(current, input))
      return { workItem: null, holderId: null, movedToColumnId: null };
    const staleAt =
      new Date(input.now).getTime() - input.staleAfterMinutes * 60_000;
    const claimable =
      current.assigneeId === null ||
      current.assigneeId === input.claimantId ||
      new Date(current.updatedAt).getTime() < staleAt;
    if (!claimable)
      return {
        workItem: null,
        holderId: current.assigneeId,
        movedToColumnId: null,
      };
    const claimed: WorkItem = {
      ...current,
      assigneeId: input.claimantId,
      updatedAt: input.now,
    };
    this.items.set(claimed.id, claimed);

    const placement = this.placements.get(input.workItemId);
    const advanceTo = placement
      ? claimTargetColumn({
          columns: [...this.columns.values()].filter(
            (column) => column.boardId === placement.boardId,
          ),
          currentColumnId: placement.columnId,
        })
      : null;
    if (placement && advanceTo)
      this.placements.set(input.workItemId, {
        ...placement,
        columnId: advanceTo,
        updatedAt: input.now,
      });
    return {
      workItem: claimed,
      holderId: input.claimantId,
      movedToColumnId: advanceTo,
    };
  }

  public async findWorkItemPlacement(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
  ): Promise<WorkItemPlacementSummary | null> {
    const placement = this.placements.get(workItemId);
    if (!placement || !sameOwner(placement, owner)) return null;
    return {
      boardId: placement.boardId,
      columnId: placement.columnId,
      position: placement.position,
    };
  }

  public async linkWork(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workItemId: string;
    readonly workId: string;
    readonly now: string;
  }): Promise<WorkItem | null> {
    const current = await this.findWorkItemById(input, input.workItemId);
    if (!current) return null;
    const next: WorkItem = {
      ...current,
      linkedWorkId: current.linkedWorkId ?? input.workId,
      updatedAt: input.now,
    };
    this.items.set(next.id, next);
    return next;
  }

  public async withPromotionLock<T>(
    _owner: WorkOrganizationOwnerScope,
    _workItemId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return callback();
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
    const item = await this.findWorkItemById(input, input.workItemId);
    if (!item) return null;
    const comment: WorkItemComment = {
      id: input.id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      workItemId: input.workItemId,
      authorId: input.authorId,
      body: input.body,
      mentions: input.mentions,
      createdAt: input.now,
    };
    this.comments.set(input.workItemId, [
      ...(this.comments.get(input.workItemId) ?? []),
      comment,
    ]);
    return comment;
  }

  public async listComments(
    owner: WorkOrganizationOwnerScope,
    workItemId: string,
  ): Promise<readonly WorkItemComment[]> {
    const item = await this.findWorkItemById(owner, workItemId);
    return item ? (this.comments.get(workItemId) ?? []) : [];
  }

  public async createBoard(input: CreateBoardRecordInput): Promise<WorkBoard> {
    const board: WorkBoard = {
      id: input.id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.boards.set(board.id, board);
    return board;
  }

  public async findBoardById(
    owner: WorkOrganizationOwnerScope,
    id: string,
  ): Promise<WorkBoard | null> {
    const board = this.boards.get(id);
    return board && sameOwner(board, owner) ? board : null;
  }

  public async listBoards(
    owner: WorkOrganizationOwnerScope,
  ): Promise<readonly WorkBoard[]> {
    return [...this.boards.values()].filter((board) => sameOwner(board, owner));
  }

  public async updateBoard(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly title?: string;
    readonly description?: string | null;
    readonly now: string;
  }): Promise<WorkBoard | null> {
    const current = await this.findBoardById(input, input.boardId);
    if (!current) return null;
    const next: WorkBoard = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      updatedAt: input.now,
    };
    this.boards.set(next.id, next);
    return next;
  }

  public async deleteBoard(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<boolean> {
    const board = await this.findBoardById(owner, boardId);
    if (!board) return false;
    this.boards.delete(boardId);
    for (const [columnId, column] of this.columns) {
      if (column.boardId === boardId) this.columns.delete(columnId);
    }
    for (const [workItemId, placement] of this.placements) {
      if (placement.boardId === boardId) this.placements.delete(workItemId);
    }
    return true;
  }

  public async createBoardColumn(
    input: CreateBoardColumnRecordInput,
  ): Promise<WorkBoardColumn | null> {
    const board = await this.findBoardById(input, input.boardId);
    if (!board) return null;
    const column: WorkBoardColumn = {
      id: input.id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      boardId: input.boardId,
      title: input.title,
      position: input.position,
      kind: input.kind,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.columns.set(column.id, column);
    return column;
  }

  public async listBoardColumns(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<readonly WorkBoardColumn[]> {
    return [...this.columns.values()]
      .filter(
        (column) => column.boardId === boardId && sameOwner(column, owner),
      )
      .sort((left, right) => left.position - right.position);
  }

  public async updateBoardColumn(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
    readonly title?: string;
    readonly position?: number;
    readonly kind?: WorkBoardColumnKind | null;
    readonly now: string;
  }): Promise<WorkBoardColumn | null> {
    const current = this.columns.get(input.columnId);
    if (
      !current ||
      !sameOwner(current, input) ||
      current.boardId !== input.boardId
    )
      return null;
    const next: WorkBoardColumn = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      updatedAt: input.now,
    };
    this.columns.set(next.id, next);
    return next;
  }

  public async deleteBoardColumn(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly boardId: string;
    readonly columnId: string;
  }): Promise<boolean> {
    const column = this.columns.get(input.columnId);
    if (
      !column ||
      !sameOwner(column, input) ||
      column.boardId !== input.boardId
    )
      return false;
    this.columns.delete(input.columnId);
    for (const [workItemId, placement] of this.placements) {
      if (placement.columnId === input.columnId)
        this.placements.delete(workItemId);
    }
    return true;
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
    const board = await this.findBoardById(input, input.boardId);
    const column = this.columns.get(input.columnId);
    const item = await this.findWorkItemById(input, input.workItemId);
    if (
      !board ||
      !column ||
      column.boardId !== input.boardId ||
      !sameOwner(column, input) ||
      !item
    )
      return null;
    const existing = this.placements.get(input.workItemId);
    const placement: WorkBoardPlacement = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      boardId: input.boardId,
      columnId: input.columnId,
      workItemId: input.workItemId,
      position: input.position,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    };
    this.placements.set(input.workItemId, placement);
    return placement;
  }

  public async getBoardSnapshot(
    owner: WorkOrganizationOwnerScope,
    boardId: string,
  ): Promise<WorkBoardSnapshot | null> {
    const board = await this.findBoardById(owner, boardId);
    if (!board) return null;
    const columns = [...this.columns.values()]
      .filter(
        (column) => column.boardId === boardId && sameOwner(column, owner),
      )
      .sort((left, right) => left.position - right.position);
    const placements = [...this.placements.values()]
      .filter(
        (placement) =>
          placement.boardId === boardId && sameOwner(placement, owner),
      )
      .sort((left, right) => left.position - right.position);
    const workItems = placements
      .map((placement) => this.items.get(placement.workItemId))
      .filter((item): item is WorkItem => item !== undefined);
    return { board, columns, placements, workItems };
  }
}

function sameOwner(
  value: { readonly tenantId: string; readonly workspaceId: string },
  owner: WorkOrganizationOwnerScope,
): boolean {
  return (
    value.tenantId === owner.tenantId && value.workspaceId === owner.workspaceId
  );
}

describe('Cumora-inspired coworker work organization MVE', () => {
  it('carries conversation work through Board, formal Work, review and Done', async () => {
    const repository = new InMemoryWorkOrganizationRepository();
    const works = new Map<string, Work>();
    let workCreateCount = 0;
    let productState: 'running' | 'complete' = 'running';
    const workIdentity: WorkOrganizationServiceOptions['workIdentity'] = {
      async createWork(input) {
        workCreateCount += 1;
        const work = createWork({
          id: '00000000-0000-4000-8000-000000000030',
          owner: input.owner,
          definitionId: input.definitionId,
          definitionVersionId: input.definitionVersionId,
          title: input.title,
          createdAt: '2026-08-26T00:00:00.000Z',
          updatedAt: '2026-08-26T00:00:00.000Z',
        });
        works.set(work.id, work);
        return work;
      },
      async findWorkById(id, owner) {
        const work = works.get(id);
        return work && sameOwner(work, owner) ? work : null;
      },
    };
    const service = new WorkOrganizationService({
      repository,
      workIdentity,
      conversations: {
        async getConversation(input) {
          return input.conversationId === conversationId
            ? ({ id: conversationId } as never)
            : null;
        },
        async listMessages(input) {
          return input.conversationId === conversationId
            ? ([{ id: messageId }] as never)
            : [];
        },
      },
      async workListProjection({ work }) {
        return {
          id: work.id,
          title: work.title,
          product_state: productState,
          latest_run_summary: {
            id: '00000000-0000-4000-8000-000000000031',
            result_summary:
              productState === 'complete' ? '正式 Work 已成功完成。' : null,
          },
        };
      },
      now: () => new Date('2026-08-26T01:00:00.000Z'),
    });

    const board = await service.createBoard({
      accessContext,
      title: '调研看板',
    });
    const todo = await service.createColumn({
      accessContext,
      boardId: board.id,
      title: '待办',
      position: 0,
    });
    const review = await service.createColumn({
      accessContext,
      boardId: board.id,
      title: '待评审',
      position: 1,
    });

    const created = await service.createWorkItem({
      accessContext,
      title: '调研竞品增长情况',
      description: '把聊天里的请求变成可追踪的 Coworker 工作。',
      assigneeId: 'agent-researcher',
      sourceConversationId: conversationId,
      sourceMessageId: messageId,
      boardId: board.id,
      columnId: todo.id,
      position: 0,
    });
    expect(created.workItem.status).toBe('todo');
    expect(created.workItem.sourceConversationId).toBe(conversationId);
    expect(created.workItem.sourceMessageId).toBe(messageId);
    expect(created.workItem.assigneeId).toBe('agent-researcher');

    const comment = await service.addComment({
      accessContext,
      workItemId: created.workItem.id,
      body: '@agent-researcher 请补充证据。',
    });
    expect(comment.body).toContain('@agent-researcher');
    expect(
      await service.listComments(accessContext, created.workItem.id),
    ).toHaveLength(1);

    await service.updateWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      status: 'in_progress',
    });
    await service.placeWorkItem({
      accessContext,
      boardId: board.id,
      columnId: review.id,
      workItemId: created.workItem.id,
      position: 0,
    });
    expect(
      (await service.getBoard(accessContext, board.id)).placements[0]?.columnId,
    ).toBe(review.id);

    const promoted = await service.promoteWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      definitionId,
      definitionVersionId,
    });
    expect(promoted.workItem.linkedWorkId).toBe(
      '00000000-0000-4000-8000-000000000030',
    );
    expect(promoted.linkedWork?.productState).toBe('running');

    const promotedAgain = await service.promoteWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      definitionId,
      definitionVersionId,
    });
    expect(promotedAgain.workItem.linkedWorkId).toBe(
      promoted.workItem.linkedWorkId,
    );
    expect(workCreateCount).toBe(1);

    productState = 'complete';
    const readyForReview = await service.getWorkItem(
      accessContext,
      created.workItem.id,
    );
    expect(readyForReview.workItem.status).toBe('in_review');
    expect(readyForReview.linkedWork?.resultSummary).toBe(
      '正式 Work 已成功完成。',
    );

    const done = await service.updateWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      status: 'done',
    });
    expect(done.workItem.status).toBe('done');

    await service.deleteBoard(accessContext, board.id);
    expect(
      await service.getWorkItem(accessContext, created.workItem.id),
    ).toMatchObject({
      workItem: { status: 'done' },
    });
  });

  it('rejects an invalid Board placement before materializing the WorkItem', async () => {
    const repository = new InMemoryWorkOrganizationRepository();
    const service = new WorkOrganizationService({
      repository,
      workIdentity: {
        async createWork() {
          throw new Error('not used');
        },
        async findWorkById() {
          return null;
        },
      },
      async workListProjection() {
        throw new Error('not used');
      },
    });

    await expect(
      service.createWorkItem({
        accessContext,
        title: '无效的看板位置',
        boardId: '00000000-0000-4000-8000-000000000099',
        columnId: '00000000-0000-4000-8000-000000000098',
      }),
    ).rejects.toMatchObject({ code: 'work_board_not_found' });
    expect(repository.items.size).toBe(0);
  });

  it('records mentions and wakes the named Coworker on create, update and comment', async () => {
    const { repository, service, wakes } = createMentionFixture();
    const created = await service.createWorkItem({
      accessContext,
      title: '整理注册转化漏斗数据',
      description: '@研究员 请先看一下上周的埋点。',
    });
    expect(created.workItem.mentions).toEqual([researcher.id]);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({
      reason: 'mention',
      mentions: [researcher.id],
      actorId: 'human-1',
      workItem: { title: '整理注册转化漏斗数据' },
    });

    // The same prose saved again must stay quiet: only tokens that were not in
    // the previous row are new, otherwise every edit re-pings everyone named.
    await service.updateWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      description: '@研究员 请先看一下上周的埋点。',
    });
    expect(wakes).toHaveLength(1);

    await service.updateWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      description: '@研究员 @文案 一起看一下。',
    });
    expect(wakes.at(-1)).toMatchObject({
      reason: 'mention',
      mentions: [writer.id],
    });

    const comment = await service.addComment({
      accessContext,
      workItemId: created.workItem.id,
      body: '@研究员 补充一下同比数据。',
    });
    expect(comment.mentions).toEqual([researcher.id]);
    expect(wakes.at(-1)).toMatchObject({
      reason: 'comment',
      mentions: [researcher.id],
      quote: '@研究员 补充一下同比数据。',
    });
    expect(repository.items.size).toBe(1);
  });

  it('treats a direct assignment as a mention and survives a failing wake', async () => {
    const { service, wakes } = createMentionFixture({ failWake: true });
    const created = await service.createWorkItem({
      accessContext,
      title: '给注册页写一版新文案',
      assigneeId: writer.id,
    });
    // The wake threw. The WorkItem write must still stand, because a chat
    // outage is not a reason to lose the user's card.
    expect(created.workItem.assigneeId).toBe(writer.id);
    expect(wakes[0]).toMatchObject({
      reason: 'assignment',
      mentions: [writer.id],
    });

    await service.updateWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      assigneeId: researcher.id,
    });
    expect(wakes.at(-1)).toMatchObject({
      reason: 'assignment',
      mentions: [researcher.id],
    });
  });

  it('lets exactly one claimant win and advances the card into the Doing column', async () => {
    const { service } = createMentionFixture();
    const board = await service.createBoard({
      accessContext,
      title: '增长看板',
    });
    const todo = await service.createColumn({
      accessContext,
      boardId: board.id,
      title: '待办',
      position: 0,
      kind: 'todo',
    });
    const doing = await service.createColumn({
      accessContext,
      boardId: board.id,
      title: '进行中',
      position: 1,
      kind: 'doing',
    });
    const created = await service.createWorkItem({
      accessContext,
      title: '核对上周的转化数据',
      boardId: board.id,
      columnId: todo.id,
      position: 0,
    });

    const claim = await service.claimWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      claimantId: researcher.id,
    });
    expect(claim.workItem.assigneeId).toBe(researcher.id);
    expect(claim.movedToColumnId).toBe(doing.id);
    expect(
      (await service.getBoard(accessContext, board.id)).placements[0]?.columnId,
    ).toBe(doing.id);

    // A second Coworker arriving after the winner must be told to stop, and the
    // holder must not change underneath the first claimant.
    await expect(
      service.claimWorkItem({
        accessContext,
        workItemId: created.workItem.id,
        claimantId: writer.id,
      }),
    ).rejects.toMatchObject({
      code: 'work_item_claim_conflict',
      holderId: researcher.id,
    });

    // Re-claiming what you already hold is idempotent, and it does not shove
    // the card forward a second time.
    const again = await service.claimWorkItem({
      accessContext,
      workItemId: created.workItem.id,
      claimantId: researcher.id,
    });
    expect(again.workItem.assigneeId).toBe(researcher.id);
    expect(again.movedToColumnId).toBeNull();
  });
});

const researcher = {
  id: '00000000-0000-4000-8000-000000000041',
  displayName: '研究员',
  normalizedName: 'agent-researcher',
  runtimeAvailable: true,
};
const writer = {
  id: '00000000-0000-4000-8000-000000000042',
  displayName: '文案',
  normalizedName: 'agent-writer',
  runtimeAvailable: true,
};

/** A service wired with a mention roster and a recording wake seam. */
function createMentionFixture(options?: { readonly failWake?: boolean }): {
  readonly repository: InMemoryWorkOrganizationRepository;
  readonly service: WorkOrganizationService;
  readonly wakes: {
    readonly reason?: string;
    readonly mentions: readonly string[];
    readonly actorId: string;
    readonly quote?: string;
    readonly workItem: { readonly title: string };
  }[];
} {
  const repository = new InMemoryWorkOrganizationRepository();
  const wakes: {
    readonly reason?: string;
    readonly mentions: readonly string[];
    readonly actorId: string;
    readonly quote?: string;
    readonly workItem: { readonly title: string };
  }[] = [];
  const service = new WorkOrganizationService({
    repository,
    workIdentity: {
      async createWork() {
        throw new Error('not used');
      },
      async findWorkById() {
        return null;
      },
    },
    async workListProjection() {
      throw new Error('not used');
    },
    mentionRoster: {
      async listMentionableAgents() {
        return [researcher, writer];
      },
    },
    async wakeMentionedAgents(input) {
      wakes.push(input);
      if (options?.failWake) throw new Error('chat plane unavailable');
      return { woken: input.mentions.length, skipped: 0 };
    },
    now: () => new Date('2026-08-26T01:00:00.000Z'),
  });
  return { repository, service, wakes };
}
