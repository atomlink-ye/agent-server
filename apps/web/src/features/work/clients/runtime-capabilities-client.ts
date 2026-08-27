import { z } from 'zod';

import { apiTransport } from '../../../api/transport';

const RuntimeCapabilitiesResponseSchema = z
  .object({
    supported_runtime_capabilities: z.array(
      z.enum(['external_workspace', 'reusable_session', 'platform_mcp']),
    ),
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
