import { z } from 'zod';

export const CreateWorkRequestSchema = z
  .object({
    definition_id: z.uuid(),
    definition_version_id: z.uuid(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const StartWorkRunRequestSchema = z
  .object({
    trigger_kind: z.literal('manual'),
    trigger_ref: z.string().min(1).max(256).optional(),
  })
  .strict();

export const WorkResponseSchema = z
  .object({
    id: z.uuid(),
    tenant_id: z.string(),
    workspace_id: z.uuid(),
    definition_id: z.uuid(),
    definition_version_id: z.uuid(),
    title: z.string(),
    origin: z.enum(['created', 'backfilled']),
    archived_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const WorkRunResponseSchema = z
  .object({
    id: z.uuid(),
    work_id: z.uuid(),
    definition_version_id: z.uuid(),
    trigger_kind: z.enum(['manual', 'webhook', 'schedule']),
    trigger_ref: z.string(),
    expires_at: z.string().datetime(),
    bound_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const CreateWorkResponseSchema = z
  .object({ work: WorkResponseSchema })
  .strict();

export const StartWorkRunResponseSchema = z
  .object({
    work_run: WorkRunResponseSchema,
    execution_receipt: z
      .object({
        reused: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type CreateWorkRequest = z.infer<typeof CreateWorkRequestSchema>;
export type StartWorkRunRequest = z.infer<typeof StartWorkRunRequestSchema>;
export type WorkResponse = z.infer<typeof WorkResponseSchema>;
export type WorkRunResponse = z.infer<typeof WorkRunResponseSchema>;

export function toWorkResponse(work: {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly currentDefinitionVersionId: string;
  readonly title: string;
  readonly origin: 'created' | 'backfilled';
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}): WorkResponse {
  return {
    id: work.id,
    tenant_id: work.tenantId,
    workspace_id: work.workspaceId,
    definition_id: work.definitionId,
    definition_version_id: work.currentDefinitionVersionId,
    title: work.title,
    origin: work.origin,
    archived_at: work.archivedAt,
    created_at: work.createdAt,
    updated_at: work.updatedAt,
  };
}

export function toWorkRunResponse(run: {
  readonly id: string;
  readonly workId: string;
  readonly definitionVersionId: string;
  readonly triggerKind: 'manual' | 'webhook' | 'schedule';
  readonly triggerRef: string;
  readonly expiresAt: string;
  readonly boundAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}): WorkRunResponse {
  return {
    id: run.id,
    work_id: run.workId,
    definition_version_id: run.definitionVersionId,
    trigger_kind: run.triggerKind,
    trigger_ref: run.triggerRef,
    expires_at: run.expiresAt,
    bound_at: run.boundAt,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

export function toExecutionReceiptResponse(receipt: { readonly reused: boolean }) {
  return { reused: receipt.reused };
}
