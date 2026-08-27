import { z } from 'zod';

/** Closed vocabulary for capabilities that affect browser-visible Work admission. */
export const WorkAdmissionCapabilitySchema = z.enum([
  'external_workspace',
  'reusable_session',
  'platform_mcp',
]);

/** Browser-safe snapshot of the execution capabilities composed by a deployment. */
export const RuntimeCapabilitiesResponseSchema = z
  .object({
    supported_runtime_capabilities: z.array(WorkAdmissionCapabilitySchema),
  })
  .strict();

export type RuntimeCapabilitiesResponse = z.infer<
  typeof RuntimeCapabilitiesResponseSchema
>;
