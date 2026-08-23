import { createHash } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type {
  RuntimeToolChatContext,
  RuntimeToolGrant,
  RuntimeToolGrantService,
} from './runtime-tool-grant-service.js';

export interface RuntimeToolContributionContext {
  readonly server: McpServer;
  readonly grant: RuntimeToolGrant;
  readonly grants: RuntimeToolGrantService;
  /** Trusted Chat origin, never sourced from MCP tool arguments. */
  readonly chatContext?: RuntimeToolChatContext;
}

export type RuntimeToolContributor = (
  context: RuntimeToolContributionContext,
) => void;

/** One composition-owned contributor is one immutable catalog item. */
export interface RuntimeToolDefinition {
  readonly ref: string;
  readonly contribute: RuntimeToolContributor;
}

export interface RuntimeToolCatalog {
  /** Stable opaque component consumed by the global bootstrap digest. */
  readonly digest: string;
  list(): readonly RuntimeToolDefinition[];
  get(ref: string): RuntimeToolDefinition | null;
}

/**
 * Freezes the Runtime tool graph before the MCP endpoint starts. The caller
 * derives the catalog-owned digest component. Global digest composition remains
 * owned outside this module.
 */
export function createRuntimeToolCatalog(
  tools: readonly RuntimeToolDefinition[],
): RuntimeToolCatalog {
  const byRef = new Map<string, RuntimeToolDefinition>();
  for (const tool of tools) {
    if (byRef.has(tool.ref))
      throw new Error(`Runtime tool catalog has duplicate ref: ${tool.ref}`);
    byRef.set(tool.ref, Object.freeze({ ...tool }));
  }
  const catalog = Object.freeze([...byRef.values()]);
  return Object.freeze({
    digest: computeRuntimeToolCatalogDigest(catalog),
    list: () => catalog,
    get: (ref: string) => byRef.get(ref) ?? null,
  });
}

/**
 * A catalog item is one composition contributor (memory, work, or legacy),
 * not an individual MCP handler. The sorted refs make equivalent composition
 * produce an identical component regardless of assembly order.
 */
export function computeRuntimeToolCatalogDigest(
  tools: readonly Pick<RuntimeToolDefinition, 'ref'>[],
): string {
  const canonical = JSON.stringify(tools.map((tool) => tool.ref).toSorted());
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
