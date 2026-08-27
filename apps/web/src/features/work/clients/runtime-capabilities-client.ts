import { z } from 'zod';

import { apiTransport } from '../../../api/transport';

const RuntimeCapabilitiesResponseSchema = z
  .object({
    supported_runtime_capabilities: z.array(z.string().min(1)),
  })
  .strict();

export async function loadRuntimeCapabilities(): Promise<readonly string[]> {
  const response = await apiTransport.request('/api/runtime-capabilities', {
    method: 'GET',
    cache: 'no-store',
  });
  return RuntimeCapabilitiesResponseSchema.parse(response)
    .supported_runtime_capabilities;
}
