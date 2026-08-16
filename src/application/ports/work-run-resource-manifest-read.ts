import type { ResolvedResourceManifestEntry } from '../../domain/work/resolved-resource-manifest.js';

export interface WorkRunManifestScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export interface WorkRunCompositionManifest {
  readonly workRunId: string;
  readonly definitionVersionId: string;
  readonly rootTaskId: string;
  readonly entries: readonly ResolvedResourceManifestEntry[];
}

/**
 * Read-only bridge from a technical root Task back to the WorkRun snapshot that
 * authorized it. Executors use this instead of resolving mutable registry refs.
 */
export interface WorkRunResourceManifestRead {
  findByRootTaskId(
    rootTaskId: string,
    scope: WorkRunManifestScope,
  ): Promise<WorkRunCompositionManifest | null>;
}
