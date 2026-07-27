import { z } from 'zod';

export const MAX_MEMORY_API_REQUEST_BYTES = 70 * 1024;
export const CreateMemoryStoreRequestSchema = z
  .object({
    workspace_id: z.uuid(),
    name: z.string().trim().min(1).max(255),
    description: z.string().max(4096).optional(),
  })
  .strict();
export const CreateMemoryRequestSchema = z
  .object({ path: z.string().min(1).max(512), content: z.string().min(1) })
  .strict();
export const UpdateMemoryRequestSchema = z
  .object({
    content: z.string().min(1),
    precondition: z
      .object({
        type: z.literal('content_sha256'),
        content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();
export const MemoryStoreResponseSchema = z.object({
  memory_store_id: z.uuid(),
  workspace_id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export const MemoryVersionResponseSchema = z.object({
  memory_version_id: z.uuid(),
  version: z.number().int().positive(),
  content_sha256: z.string(),
  content_size_bytes: z.number().int().positive(),
  content: z.string(),
});
export const MemoryResponseSchema = z.object({
  memory_id: z.uuid(),
  memory_store_id: z.uuid(),
  path: z.string(),
  memory_version_id: z.uuid(),
  version: z.number().int().positive(),
  content_sha256: z.string(),
  content_size_bytes: z.number().int().positive(),
  content: z.string().min(1),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type CreateMemoryStoreRequest = z.infer<
  typeof CreateMemoryStoreRequestSchema
>;
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequestSchema>;
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequestSchema>;
