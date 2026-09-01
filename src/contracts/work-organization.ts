import { z } from 'zod';

export const WORK_ITEM_NOT_FOUND_CODE = 'work_item_not_found';
export const WORK_BOARD_NOT_FOUND_CODE = 'work_board_not_found';

export const WORK_ITEM_CLAIM_CONFLICT_CODE = 'work_item_claim_conflict';

export const WorkItemStatusSchema = z.enum([
  'todo',
  'in_progress',
  'in_review',
  'done',
]);

/**
 * What a Board column MEANS, as opposed to what it is titled. Null is a real
 * answer — a column whose meaning was never declared is left unclassified
 * rather than guessed at, because a wrong guess silently moves someone's cards.
 */
export const WorkBoardColumnKindSchema = z.enum(['todo', 'doing', 'done']);

/** Identities named by @-tokens in prose, resolved at write time. */
export const MentionsSchema = z.array(z.string().min(1).max(256)).max(64);

export const LinkedWorkSummarySchema = z
  .object({
    work_id: z.uuid(),
    title: z.string().min(1),
    product_state: z.enum([
      'running',
      'needs_you',
      'complete',
      'problem',
      'not_captured',
    ]),
    latest_work_run_id: z.uuid().nullable(),
    result_summary: z.string().nullable(),
  })
  .strict();

export const WorkItemSchema = z
  .object({
    id: z.uuid(),
    workspace_id: z.uuid(),
    title: z.string().min(1).max(200),
    description: z.string().nullable(),
    status: WorkItemStatusSchema,
    assignee_id: z.string().min(1).max(256).nullable(),
    mentions: MentionsSchema,
    created_by: z.string().min(1),
    source_conversation_id: z.uuid().nullable(),
    source_message_id: z.uuid().nullable(),
    linked_work_id: z.uuid().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const WorkItemDetailSchema = z
  .object({
    work_item: WorkItemSchema,
    linked_work: LinkedWorkSummarySchema.nullable(),
  })
  .strict();

export const WorkItemListResponseSchema = z
  .object({ work_items: z.array(WorkItemDetailSchema) })
  .strict();

export const CreateWorkItemRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z
      .string()
      .trim()
      .max(16 * 1024)
      .nullable()
      .optional(),
    assignee_id: z.string().trim().min(1).max(256).nullable().optional(),
    source_conversation_id: z.uuid().nullable().optional(),
    source_message_id: z.uuid().nullable().optional(),
    board_id: z.uuid().nullable().optional(),
    column_id: z.uuid().nullable().optional(),
    position: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const UpdateWorkItemRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z
      .string()
      .trim()
      .max(16 * 1024)
      .nullable()
      .optional(),
    status: WorkItemStatusSchema.optional(),
    assignee_id: z.string().trim().min(1).max(256).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one WorkItem field must be updated.',
  });

export const PromoteWorkItemRequestSchema = z
  .object({
    definition_id: z.uuid(),
    definition_version_id: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const WorkItemCommentSchema = z
  .object({
    id: z.uuid(),
    work_item_id: z.uuid(),
    author_id: z.string().min(1),
    body: z
      .string()
      .min(1)
      .max(16 * 1024),
    mentions: MentionsSchema,
    created_at: z.string().datetime(),
  })
  .strict();

export const CreateWorkItemCommentRequestSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(16 * 1024),
  })
  .strict();

export const WorkItemCommentsResponseSchema = z
  .object({ comments: z.array(WorkItemCommentSchema) })
  .strict();

export const WorkBoardSchema = z
  .object({
    id: z.uuid(),
    workspace_id: z.uuid(),
    title: z.string().min(1).max(120),
    description: z.string().nullable(),
    created_by: z.string().min(1),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const WorkBoardColumnSchema = z
  .object({
    id: z.uuid(),
    board_id: z.uuid(),
    title: z.string().min(1).max(120),
    position: z.number().int().nonnegative(),
    kind: WorkBoardColumnKindSchema.nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const WorkBoardPlacementSchema = z
  .object({
    board_id: z.uuid(),
    column_id: z.uuid(),
    work_item_id: z.uuid(),
    position: z.number().int().nonnegative(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const WorkBoardListResponseSchema = z
  .object({ boards: z.array(WorkBoardSchema) })
  .strict();

export const WorkBoardSnapshotSchema = z
  .object({
    board: WorkBoardSchema,
    columns: z.array(WorkBoardColumnSchema),
    placements: z.array(WorkBoardPlacementSchema),
    work_items: z.array(WorkItemSchema),
  })
  .strict();

export const CreateWorkBoardRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4096).nullable().optional(),
  })
  .strict();

export const UpdateWorkBoardRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(4096).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one Board field must be updated.',
  });

export const CreateWorkBoardColumnRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    position: z.number().int().min(0).max(1_000_000).optional(),
    kind: WorkBoardColumnKindSchema.nullable().optional(),
  })
  .strict();

export const UpdateWorkBoardColumnRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    position: z.number().int().min(0).max(1_000_000).optional(),
    kind: WorkBoardColumnKindSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one Board column field must be updated.',
  });

/**
 * Claiming takes the caller's identity from the request credentials, so the
 * body carries no claimant. An empty body is accepted and means "claim for me",
 * which keeps the browser button a one-liner.
 */
export const ClaimWorkItemRequestSchema = z.object({}).strict();

export const ClaimWorkItemResponseSchema = z
  .object({
    work_item: WorkItemSchema,
    /**
     * The column the claim advanced the WorkItem into, or null when it stayed
     * put — off-board, already Doing, Done, or on a board whose columns do not
     * declare their kind.
     */
    moved_to_column_id: z.uuid().nullable(),
  })
  .strict();

export const PlaceWorkItemRequestSchema = z
  .object({
    column_id: z.uuid(),
    work_item_id: z.uuid(),
    position: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export type WorkItemStatus = z.infer<typeof WorkItemStatusSchema>;
export type WorkItemDto = z.infer<typeof WorkItemSchema>;
export type WorkItemDetailDto = z.infer<typeof WorkItemDetailSchema>;
export type WorkItemCommentDto = z.infer<typeof WorkItemCommentSchema>;
export type WorkBoardDto = z.infer<typeof WorkBoardSchema>;
export type WorkBoardColumnDto = z.infer<typeof WorkBoardColumnSchema>;
export type WorkBoardPlacementDto = z.infer<typeof WorkBoardPlacementSchema>;
export type WorkBoardSnapshotDto = z.infer<typeof WorkBoardSnapshotSchema>;
export type WorkBoardColumnKind = z.infer<typeof WorkBoardColumnKindSchema>;
export type ClaimWorkItemResponseDto = z.infer<
  typeof ClaimWorkItemResponseSchema
>;

export function toClaimWorkItemResponse(input: {
  readonly workItem: Parameters<typeof toWorkItemResponse>[0];
  readonly movedToColumnId: string | null;
}): ClaimWorkItemResponseDto {
  return ClaimWorkItemResponseSchema.parse({
    work_item: toWorkItemResponse(input.workItem),
    moved_to_column_id: input.movedToColumnId,
  });
}

export function toWorkItemDetailResponse(input: {
  readonly workItem: {
    readonly id: string;
    readonly workspaceId: string;
    readonly title: string;
    readonly description: string | null;
    readonly status: WorkItemStatus;
    readonly assigneeId: string | null;
    readonly mentions: readonly string[];
    readonly createdBy: string;
    readonly sourceConversationId: string | null;
    readonly sourceMessageId: string | null;
    readonly linkedWorkId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly linkedWork: {
    readonly workId: string;
    readonly title: string;
    readonly productState:
      'running' | 'needs_you' | 'complete' | 'problem' | 'not_captured';
    readonly latestWorkRunId: string | null;
    readonly resultSummary: string | null;
  } | null;
}): WorkItemDetailDto {
  return WorkItemDetailSchema.parse({
    work_item: toWorkItemResponse(input.workItem),
    linked_work: input.linkedWork
      ? {
          work_id: input.linkedWork.workId,
          title: input.linkedWork.title,
          product_state: input.linkedWork.productState,
          latest_work_run_id: input.linkedWork.latestWorkRunId,
          result_summary: input.linkedWork.resultSummary,
        }
      : null,
  });
}

export function toWorkItemResponse(input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: WorkItemStatus;
  readonly assigneeId: string | null;
  readonly mentions: readonly string[];
  readonly createdBy: string;
  readonly sourceConversationId: string | null;
  readonly sourceMessageId: string | null;
  readonly linkedWorkId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}): WorkItemDto {
  return WorkItemSchema.parse({
    id: input.id,
    workspace_id: input.workspaceId,
    title: input.title,
    description: input.description,
    status: input.status,
    assignee_id: input.assigneeId,
    mentions: [...input.mentions],
    created_by: input.createdBy,
    source_conversation_id: input.sourceConversationId,
    source_message_id: input.sourceMessageId,
    linked_work_id: input.linkedWorkId,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

export function toWorkItemCommentResponse(input: {
  readonly id: string;
  readonly workItemId: string;
  readonly authorId: string;
  readonly body: string;
  readonly mentions: readonly string[];
  readonly createdAt: string;
}): WorkItemCommentDto {
  return WorkItemCommentSchema.parse({
    id: input.id,
    work_item_id: input.workItemId,
    author_id: input.authorId,
    body: input.body,
    mentions: [...input.mentions],
    created_at: input.createdAt,
  });
}

export function toWorkBoardResponse(input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly description: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}): WorkBoardDto {
  return WorkBoardSchema.parse({
    id: input.id,
    workspace_id: input.workspaceId,
    title: input.title,
    description: input.description,
    created_by: input.createdBy,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

export function toWorkBoardColumnResponse(input: {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly position: number;
  readonly kind: WorkBoardColumnKind | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}): WorkBoardColumnDto {
  return WorkBoardColumnSchema.parse({
    id: input.id,
    board_id: input.boardId,
    title: input.title,
    position: input.position,
    kind: input.kind,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

export function toWorkBoardPlacementResponse(input: {
  readonly boardId: string;
  readonly columnId: string;
  readonly workItemId: string;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}): WorkBoardPlacementDto {
  return WorkBoardPlacementSchema.parse({
    board_id: input.boardId,
    column_id: input.columnId,
    work_item_id: input.workItemId,
    position: input.position,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}
