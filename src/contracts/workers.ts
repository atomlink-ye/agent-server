import { z } from 'zod';

export const MAX_WORKER_REQUEST_BYTES = 64 * 1024;
export const WorkerIdSchema = z.string().uuid();
const timestamp = z.iso.datetime({ offset: true });
const fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const compiler = z
  .object({
    pattern_dialect: z.literal('re2'),
    pattern_compiler_version: z.literal('re2js-2.8.6'),
  })
  .strict();

export const WorkerPackageRequestSchema = z
  .object({ source: z.string() })
  .strict();
export const PublishWorkerVersionRequestSchema = z.object({}).strict();

export const WorkerDefinitionResponseSchema = z
  .object({
    id: WorkerIdSchema,
    normalized_name: z.string().min(1),
    display_name: z.string().min(1),
    created_at: timestamp,
    updated_at: timestamp,
  })
  .strict();

export const WorkerVersionResponseSchema = z
  .object({
    id: WorkerIdSchema,
    definition_id: WorkerIdSchema,
    status: z.enum(['draft', 'published']),
    display_name: z.string().min(1),
    fingerprint,
    compiler,
    created_at: timestamp,
    updated_at: timestamp,
    published_at: timestamp.nullable(),
    links: z.object({ self: z.string(), definition: z.string() }).strict(),
  })
  .strict();

export const ValidateWorkerPackageResponseSchema = z
  .object({
    valid: z.literal(true),
    fingerprint,
    metadata: z.object({ normalized_name: z.string().min(1) }).strict(),
    compiler,
  })
  .strict();

export const ImportWorkerResponseSchema = z
  .object({
    result: z.enum(['created', 'converged', 'replayed']),
    worker: WorkerDefinitionResponseSchema,
    version: WorkerVersionResponseSchema,
  })
  .strict();
