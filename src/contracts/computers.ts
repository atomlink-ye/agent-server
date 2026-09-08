import { z } from 'zod';

export const MAX_COMPUTER_REQUEST_BYTES = 16 * 1024;

const uuidPattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const ComputerIdSchema = z
  .string()
  .regex(new RegExp(`^${uuidPattern}$`));
const timestampSchema = z.iso.datetime({ offset: true });

export const ComputerKindSchema = z.enum(['cloud', 'local', 'vps']);
export const ComputerStatusSchema = z.enum(['online', 'offline']);

export const CreateComputerRequestSchema = z
  .object({
    kind: ComputerKindSchema,
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const ComputerResponseSchema = z
  .object({
    id: ComputerIdSchema,
    kind: ComputerKindSchema,
    name: z.string().min(1).max(120),
    status: ComputerStatusSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export const ListComputersResponseSchema = z
  .object({
    items: z.array(ComputerResponseSchema),
  })
  .strict();

export type CreateComputerRequest = z.infer<typeof CreateComputerRequestSchema>;
export type ComputerResponse = z.infer<typeof ComputerResponseSchema>;
export type ListComputersResponse = z.infer<typeof ListComputersResponseSchema>;
