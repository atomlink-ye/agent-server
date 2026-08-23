import { createHash } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthorizedRuntimeToolContext } from '../runtime/authorize-runtime-tool.js';

export interface RuntimeToolContributionContext {
  readonly server: McpServer;
  readonly grant: AuthorizedRuntimeToolContext;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
}

export type RuntimeToolContributor = (
  context: RuntimeToolContributionContext,
) => void;

/** One composition-owned contributor is one immutable catalog item. */
export interface RuntimeToolDefinition {
  readonly ref: string;
  /** Public Agent/runtime tool refs contributed by this composition owner. */
  readonly toolRefs: readonly string[];
  readonly contribute: RuntimeToolContributor;
}

export interface RuntimeToolCatalog {
  /** Stable opaque component consumed by the global bootstrap digest. */
  readonly digest: string;
  list(): readonly RuntimeToolDefinition[];
  toolRefs(): readonly string[];
  hasTool(ref: string): boolean;
  contribute(context: RuntimeToolContributionContext): void;
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
  const publicToolRefs = new Set<string>();
  for (const tool of tools) {
    if (byRef.has(tool.ref))
      throw new Error(`Runtime tool catalog has duplicate ref: ${tool.ref}`);
    const toolRefs = Object.freeze([...tool.toolRefs]);
    for (const toolRef of toolRefs) {
      if (publicToolRefs.has(toolRef))
        throw new Error(`Runtime tool catalog has duplicate tool ref: ${toolRef}`);
      publicToolRefs.add(toolRef);
    }
    byRef.set(tool.ref, Object.freeze({ ...tool, toolRefs }));
  }
  const catalog = Object.freeze([...byRef.values()]);
  return Object.freeze({
    digest: computeRuntimeToolCatalogDigest(catalog),
    list: () => catalog,
    toolRefs: () => Object.freeze([...publicToolRefs].toSorted()),
    hasTool: (ref: string) => publicToolRefs.has(ref),
    contribute: (context: RuntimeToolContributionContext) => {
      for (const tool of catalog) tool.contribute(context);
    },
  });
}

/**
 * The digest binds both composition ownership and its public tool refs. This
 * keeps contributor grouping separate from Agent-declared grant identities.
 */
export function computeRuntimeToolCatalogDigest(
  tools: readonly Pick<RuntimeToolDefinition, 'ref' | 'toolRefs'>[],
): string {
  const canonical = JSON.stringify(
    tools
      .map((tool) => ({ ref: tool.ref, toolRefs: [...tool.toolRefs].toSorted() }))
      .toSorted((left, right) => left.ref.localeCompare(right.ref)),
  );
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
