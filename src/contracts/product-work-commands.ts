import { z } from 'zod';

import {
  TeamDefinitionResponseSchema,
  TeamVersionResponseSchema,
} from './teams.js';
import { ProductStateSchema } from './product-projection/product-state.js';

export const CreateWorkRequestSchema = z
  .object({
    definition_id: z.uuid(),
    definition_version_id: z.uuid(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const UpdateWorkDefinitionVersionRequestSchema = z
  .object({ definition_version_id: z.uuid() })
  .strict();

export const StartWorkRunRequestSchema = z
  .object({
    trigger_kind: z.literal('manual'),
    trigger_ref: z.string().min(1).max(256).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ListWorksRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).nullable().optional(),
    order: z.literal('updated_desc').optional(),
  })
  .strict();

export const GetWorkRequestSchema = z.object({ work_id: z.uuid() }).strict();

export const ListWorkRunsRequestSchema = z
  .object({
    work_id: z.uuid(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).nullable().optional(),
    order: z.literal('created_desc').optional(),
  })
  .strict();

export const GetWorkRunRequestSchema = z
  .object({ work_id: z.uuid(), work_run_id: z.uuid() })
  .strict();

export const GetRunTraceRequestSchema = GetWorkRunRequestSchema;

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

export const LatestWorkRunSummarySchema = z
  .object({
    id: z.uuid(),
    updated_at: z.string().datetime(),
    result_summary: z.string().nullable(),
    result_capture_status: z.enum([
      'present',
      'not_present',
      'redacted',
      'not_captured',
    ]),
  })
  .strict();

export const WorkListItemSchema = WorkResponseSchema.extend({
  product_state: ProductStateSchema,
  latest_run_summary: LatestWorkRunSummarySchema.nullable(),
}).strict();

export const WorkRunSummarySchema = z
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

export const UpdateWorkDefinitionVersionResponseSchema = CreateWorkResponseSchema;

export const StartWorkRunResponseSchema = z
  .object({
    work_run: WorkRunSummarySchema,
    execution_receipt: z
      .object({
        reused: z.boolean(),
        source_refs: z
          .object({
            task_id: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const WorkListResponseSchema = z
  .object({
    works: z.array(WorkListItemSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();
export const WorkRunListResponseSchema = z
  .object({
    work_runs: z.array(WorkRunSummarySchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export const GetWorkResponseSchema = z
  .object({ work: WorkResponseSchema })
  .strict();

/** Backwards-compatible name for the summary DTO. */
export const WorkRunResponseSchema = WorkRunSummarySchema;

export type CreateWorkRequest = z.infer<typeof CreateWorkRequestSchema>;
export type UpdateWorkDefinitionVersionRequest = z.infer<
  typeof UpdateWorkDefinitionVersionRequestSchema
>;
export type UpdateWorkDefinitionVersionResponse = z.infer<
  typeof UpdateWorkDefinitionVersionResponseSchema
>;
export type StartWorkRunRequest = z.infer<typeof StartWorkRunRequestSchema>;
export type WorkResponse = z.infer<typeof WorkResponseSchema>;
export type WorkListItem = z.infer<typeof WorkListItemSchema>;
export type LatestWorkRunSummary = z.infer<typeof LatestWorkRunSummarySchema>;
export type WorkRunSummary = z.infer<typeof WorkRunSummarySchema>;
export type WorkRunResponse = WorkRunSummary;
export type WorkListResponse = z.infer<typeof WorkListResponseSchema>;
export type WorkRunListResponse = z.infer<typeof WorkRunListResponseSchema>;
export type GetWorkResponse = z.infer<typeof GetWorkResponseSchema>;

/**
 * Compatibility-only Team-shaped Definition response retained for the original
 * Work read route. Canonical Product consumers use product-work-definitions.ts
 * and exact WorkDefinitionVersion identity instead.
 */
export const WorkDefinitionResponseSchema = z
  .object({
    definition: TeamDefinitionResponseSchema,
    version: TeamVersionResponseSchema,
  })
  .strict();

export type WorkDefinitionResponse = z.infer<
  typeof WorkDefinitionResponseSchema
>;

export function toWorkDefinitionResponse(input: {
  readonly definition: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly version: {
    readonly id: string;
    readonly definitionId: string;
    readonly status: 'draft' | 'published';
    readonly name: string;
    readonly description: string | null;
    readonly environmentVersionId: string;
    readonly spec: {
      readonly lead: {
        readonly name: string;
        readonly agentVersionId: string;
      };
      readonly roster: readonly {
        readonly name: string;
        readonly agentVersionId: string;
      }[];
      readonly environmentVersionId: string;
    };
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly publishedAt: string | null;
  };
}): WorkDefinitionResponse {
  const { definition, version } = input;
  return WorkDefinitionResponseSchema.parse({
    definition: {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      created_at: definition.createdAt,
      updated_at: definition.updatedAt,
      links: {
        self: `/api/v1/teams/${definition.id}`,
        versions: `/api/v1/teams/${definition.id}/versions`,
      },
    },
    version: {
      id: version.id,
      definition_id: version.definitionId,
      status: version.status,
      name: version.name,
      description: version.description,
      environment_version_id: version.environmentVersionId,
      spec: version.spec,
      created_at: version.createdAt,
      updated_at: version.updatedAt,
      published_at: version.publishedAt,
      links: {
        self: `/api/v1/team-versions/${version.id}`,
        definition: `/api/v1/teams/${version.definitionId}`,
      },
    },
  });
}

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
}): WorkRunSummary {
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

export const toWorkRunSummaryResponse = toWorkRunResponse;

export function toExecutionReceiptResponse(receipt: {
  readonly reused: boolean;
  readonly taskId: string;
}) {
  return {
    reused: receipt.reused,
    source_refs: { task_id: receipt.taskId },
  };
}
