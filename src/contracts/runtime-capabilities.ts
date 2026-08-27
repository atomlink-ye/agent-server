import { z } from 'zod';

/** Browser-safe snapshot of the execution capabilities composed by a deployment. */
export const RuntimeCapabilitiesResponseSchema = z
  .object({
    supported_runtime_capabilities: z.array(z.string().min(1)),
  })
  .strict();

export type RuntimeCapabilitiesResponse = z.infer<
  typeof RuntimeCapabilitiesResponseSchema
>;
