import {
  WORK_ITEM_NOT_FOUND_CODE,
  WorkBoardListResponseSchema,
  WorkBoardSnapshotSchema,
  WorkItemCommentSchema,
  WorkItemCommentsResponseSchema,
  WorkItemDetailSchema,
  WorkItemListResponseSchema,
  WorkItemSchema,
  WorkBoardSchema,
  WorkBoardColumnSchema,
  WorkBoardPlacementSchema,
  type WorkBoardDto,
  type WorkBoardSnapshotDto,
  type WorkItemDetailDto,
  type WorkItemDto,
  type WorkItemStatus,
} from '@atomlink-ye/agent-server/product-contract';
import { z } from 'zod';

import {
  isFeatureUnavailable,
  isResourceNotFound,
} from '../../api/feature-availability';
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

/**
 * The shared work-organization schemas are `.strict()`, so a response that
 * carries a field this build has never heard of is a hard parse failure. That
 * is the right default for a contract the browser owns, but it also means the
 * next backend field (`mentions`, column `kind`, the claim bookkeeping) would
 * black out Tasks and Boards on deploy-skew rather than simply going
 * unrendered.
 *
 * So an unrecognized key is tolerated and nothing else is: the response is
 * re-validated with the unknown keys removed, and only if that passes does the
 * caller get the value back — unpruned, so the forward-compatible readers in
 * `work-item-extensions.ts` can still see the new fields. A genuinely wrong
 * shape (missing field, wrong type) still fails exactly as before.
 */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = tolerantParse(schema, value);
  if (parsed === null)
    throw new Error(
      'The work-organization response did not match the browser contract.',
    );
  return parsed;
}

/** `parse` without the throw — null means "this is not that shape". */
function tolerantParse<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const unrecognized = result.error.issues.filter(
    (issue) => issue.code === 'unrecognized_keys',
  );
  if (unrecognized.length !== result.error.issues.length) return null;

  const pruned = structuredClone(value);
  for (const issue of unrecognized) deleteKeys(pruned, issue.path, issue.keys);
  return schema.safeParse(pruned).success ? (value as T) : null;
}

function deleteKeys(
  root: unknown,
  path: readonly PropertyKey[],
  keys: readonly string[],
): void {
  let target: unknown = root;
  for (const segment of path) {
    if (target === null || typeof target !== 'object') return;
    target = (target as Record<PropertyKey, unknown>)[segment];
  }
  if (target === null || typeof target !== 'object') return;
  for (const key of keys) delete (target as Record<string, unknown>)[key];
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

export interface ClaimResult {
  /** False when this deployment has no claim endpoint yet. */
  readonly supported: boolean;
  /** The claimed WorkItem, when the response carried a recognizable one. */
  readonly workItem: WorkItemDto | null;
  /**
   * The Board column the claim advanced the WorkItem into, or null when it
   * stayed put (off-board, already Doing/Done, or an unclassified column).
   */
  readonly movedToColumnId: string | null;
}

/**
 * A 404 from the claim route means one of two very different things: the route
 * does not exist in this deployment, or the WorkItem does not. Only the first
 * is "claim unsupported" — the second is a real error the user must see.
 */
function isMissingRoute(reason: unknown): boolean {
  if (isResourceNotFound(reason, WORK_ITEM_NOT_FOUND_CODE)) return false;
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'status' in reason &&
    (reason as { status?: unknown }).status === 404
  );
}

/**
 * The backend's real claim response is `{ work_item, moved_to_column_id }`
 * (`ClaimWorkItemResponseSchema`). Kept shape-tolerant for a bare WorkItem or
 * a `WorkItemDetailSchema`-shaped body too, since nothing stops a future
 * deployment answering either.
 */
function readClaimedWorkItem(payload: unknown): {
  readonly workItem: WorkItemDto;
  readonly movedToColumnId: string | null;
} | null {
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const workItem = tolerantParse(WorkItemSchema, record.work_item);
    if (workItem) {
      const movedToColumnId =
        typeof record.moved_to_column_id === 'string'
          ? record.moved_to_column_id
          : null;
      return { workItem, movedToColumnId };
    }
  }
  const detail = tolerantParse(WorkItemDetailSchema, payload);
  if (detail) return { workItem: detail.work_item, movedToColumnId: null };
  const bare = tolerantParse(WorkItemSchema, payload);
  if (bare) return { workItem: bare, movedToColumnId: null };
  return null;
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

  /**
   * Claim a WorkItem through the backend's atomic claim primitive.
   *
   * The endpoint is still being built by the backend Worker, so this call is
   * deliberately shape-tolerant: it accepts a `{ work_item }`, a
   * `{ work_item, linked_work }` detail, or a bare acknowledgement, and it
   * reports `supported: false` — rather than a fake success — when the route
   * is absent or the surface is not composed. The caller refetches either way,
   * so a claim that succeeded with an unfamiliar body is still reflected.
   */
  async claimWorkItem(workItemId: string): Promise<ClaimResult> {
    let payload: unknown;
    try {
      payload = await apiTransport.request(
        `/api/work-items/${encodeURIComponent(workItemId)}/claim`,
        { method: 'POST', cache: 'no-store' },
      );
    } catch (reason) {
      if (isFeatureUnavailable(reason) || isMissingRoute(reason))
        return { supported: false, workItem: null, movedToColumnId: null };
      throw reason;
    }
    const read = readClaimedWorkItem(payload);
    return {
      supported: true,
      workItem: read?.workItem ?? null,
      movedToColumnId: read?.movedToColumnId ?? null,
    };
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
