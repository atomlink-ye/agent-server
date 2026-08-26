import {
  WorkBoardListResponseSchema,
  WorkBoardSnapshotSchema,
  WorkItemCommentSchema,
  WorkItemCommentsResponseSchema,
  WorkItemDetailSchema,
  WorkItemListResponseSchema,
  WorkBoardSchema,
  WorkBoardColumnSchema,
  WorkBoardPlacementSchema,
  type WorkBoardDto,
  type WorkBoardSnapshotDto,
  type WorkItemDetailDto,
  type WorkItemStatus,
} from '@atomlink-ye/agent-server/product-contract';
import { z } from 'zod';

import { apiTransport } from '../../api/transport';

const boardResponseSchema = z.object({ board: WorkBoardSchema }).strict();
const columnResponseSchema = z
  .object({ column: WorkBoardColumnSchema })
  .strict();
const placementResponseSchema = z
  .object({ placement: WorkBoardPlacementSchema })
  .strict();
const commentResponseSchema = z
  .object({ comment: WorkItemCommentSchema })
  .strict();
const publishedWorkDefinitionsResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          definitionId: z.string().min(1),
          displayName: z.string().min(1),
          currentPublishedVersionId: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type PublishedWorkDefinition = z.infer<
  typeof publishedWorkDefinitionsResponseSchema
>['items'][number];

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      'The work-organization response did not match the browser contract.',
    );
  return result.data;
}

export interface CreateWorkItemInput {
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
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: WorkItemStatus;
  readonly assigneeId?: string | null;
}

export const workOrganizationClient = {
  async listPublishedWorkDefinitions(): Promise<
    readonly PublishedWorkDefinition[]
  > {
    return parse(
      publishedWorkDefinitionsResponseSchema,
      await apiTransport.request('/api/work-definitions', {
        method: 'GET',
        cache: 'no-store',
      }),
    ).items;
  },

  async listWorkItems(): Promise<readonly WorkItemDetailDto[]> {
    const response = parse(
      WorkItemListResponseSchema,
      await apiTransport.request('/api/work-items', {
        method: 'GET',
        cache: 'no-store',
      }),
    );
    return response.work_items;
  },

  async getWorkItem(workItemId: string): Promise<WorkItemDetailDto> {
    return parse(
      WorkItemDetailSchema,
      await apiTransport.request(
        `/api/work-items/${encodeURIComponent(workItemId)}`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      ),
    );
  },

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItemDetailDto> {
    return parse(
      WorkItemDetailSchema,
      await apiTransport.request('/api/work-items', {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({
          title: input.title,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.assigneeId !== undefined
            ? { assignee_id: input.assigneeId }
            : {}),
          ...(input.sourceConversationId !== undefined
            ? { source_conversation_id: input.sourceConversationId }
            : {}),
          ...(input.sourceMessageId !== undefined
            ? { source_message_id: input.sourceMessageId }
            : {}),
          ...(input.boardId !== undefined ? { board_id: input.boardId } : {}),
          ...(input.columnId !== undefined
            ? { column_id: input.columnId }
            : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
        }),
      }),
    );
  },

  async updateWorkItem(
    workItemId: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItemDetailDto> {
    return parse(
      WorkItemDetailSchema,
      await apiTransport.request(
        `/api/work-items/${encodeURIComponent(workItemId)}`,
        {
          method: 'PATCH',
          cache: 'no-store',
          body: JSON.stringify({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.assigneeId !== undefined
              ? { assignee_id: input.assigneeId }
              : {}),
          }),
        },
      ),
    );
  },

  async promoteWorkItem(
    workItemId: string,
    input: {
      readonly definitionId: string;
      readonly definitionVersionId: string;
      readonly title?: string;
    },
  ): Promise<WorkItemDetailDto> {
    return parse(
      WorkItemDetailSchema,
      await apiTransport.request(
        `/api/work-items/${encodeURIComponent(workItemId)}/promote`,
        {
          method: 'POST',
          cache: 'no-store',
          body: JSON.stringify({
            definition_id: input.definitionId,
            definition_version_id: input.definitionVersionId,
            ...(input.title ? { title: input.title } : {}),
          }),
        },
      ),
    );
  },

  async listComments(workItemId: string) {
    const response = parse(
      WorkItemCommentsResponseSchema,
      await apiTransport.request(
        `/api/work-items/${encodeURIComponent(workItemId)}/comments`,
        { method: 'GET', cache: 'no-store' },
      ),
    );
    return response.comments;
  },

  async addComment(workItemId: string, body: string) {
    const response = parse(
      commentResponseSchema,
      await apiTransport.request(
        `/api/work-items/${encodeURIComponent(workItemId)}/comments`,
        {
          method: 'POST',
          cache: 'no-store',
          body: JSON.stringify({ body }),
        },
      ),
    );
    return response.comment;
  },

  async listBoards(): Promise<readonly WorkBoardDto[]> {
    const response = parse(
      WorkBoardListResponseSchema,
      await apiTransport.request('/api/boards', {
        method: 'GET',
        cache: 'no-store',
      }),
    );
    return response.boards;
  },

  async getBoard(boardId: string): Promise<WorkBoardSnapshotDto> {
    return parse(
      WorkBoardSnapshotSchema,
      await apiTransport.request(`/api/boards/${encodeURIComponent(boardId)}`, {
        method: 'GET',
        cache: 'no-store',
      }),
    );
  },

  async createBoard(input: {
    readonly title: string;
    readonly description?: string | null;
  }): Promise<WorkBoardDto> {
    const response = parse(
      boardResponseSchema,
      await apiTransport.request('/api/boards', {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify(input),
      }),
    );
    return response.board;
  },

  async updateBoard(
    boardId: string,
    input: { readonly title?: string; readonly description?: string | null },
  ): Promise<WorkBoardDto> {
    const response = parse(
      boardResponseSchema,
      await apiTransport.request(`/api/boards/${encodeURIComponent(boardId)}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify(input),
      }),
    );
    return response.board;
  },

  async deleteBoard(boardId: string): Promise<void> {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('The Board could not be deleted.');
  },

  async createColumn(
    boardId: string,
    input: { readonly title: string; readonly position?: number },
  ) {
    const response = parse(
      columnResponseSchema,
      await apiTransport.request(
        `/api/boards/${encodeURIComponent(boardId)}/columns`,
        {
          method: 'POST',
          cache: 'no-store',
          body: JSON.stringify(input),
        },
      ),
    );
    return response.column;
  },

  async updateColumn(
    boardId: string,
    columnId: string,
    input: { readonly title?: string; readonly position?: number },
  ) {
    const response = parse(
      columnResponseSchema,
      await apiTransport.request(
        `/api/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}`,
        { method: 'PATCH', cache: 'no-store', body: JSON.stringify(input) },
      ),
    );
    return response.column;
  },

  async deleteColumn(boardId: string, columnId: string): Promise<void> {
    const response = await fetch(
      `/api/boards/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
    if (!response.ok) throw new Error('The Board column could not be deleted.');
  },

  async placeWorkItem(
    boardId: string,
    input: {
      readonly columnId: string;
      readonly workItemId: string;
      readonly position?: number;
    },
  ) {
    const response = parse(
      placementResponseSchema,
      await apiTransport.request(
        `/api/boards/${encodeURIComponent(boardId)}/placement`,
        {
          method: 'PUT',
          cache: 'no-store',
          body: JSON.stringify({
            column_id: input.columnId,
            work_item_id: input.workItemId,
            ...(input.position !== undefined
              ? { position: input.position }
              : {}),
          }),
        },
      ),
    );
    return response.placement;
  },
};
