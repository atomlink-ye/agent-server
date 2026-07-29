import { z } from 'zod';
export const MAX_ENVIRONMENT_REQUEST_BYTES = 64 * 1024;
export const EnvironmentIdSchema = z.string().uuid();
export const EnvironmentPackageRequestSchema = z
  .object({ source: z.string() })
  .strict();
export const EnvironmentPublishRequestSchema = z.object({}).strict();
export const EnvironmentVersionResponseSchema = z
  .object({
    id: z.string().uuid(),
    definition_id: z.string().uuid(),
    status: z.enum(['draft', 'published']),
    display_name: z.string(),
    fingerprint: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    published_at: z.string().nullable(),
    links: z.object({ self: z.string() }).strict(),
  })
  .strict();
