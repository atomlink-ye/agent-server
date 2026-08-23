import type { RuntimeMcpEndpoint } from '../application/ports/runtime-mcp-endpoint.js';
import type { RuntimeMcpServer } from '../infrastructure/extensions/runtime-mcp-server.js';

/**
 * Bridges the infrastructure-owned listener to the narrow application port.
 * The endpoint is resolved at use time because its URL is a live listener fact.
 */
export function createRuntimeMcpEndpoint(
  server: Pick<RuntimeMcpServer, 'startEndpoint'>,
): RuntimeMcpEndpoint {
  return Object.freeze({
    current: async () => {
      const endpoint = await server.startEndpoint();
      return Object.freeze({ url: endpoint.url });
    },
  });
}
