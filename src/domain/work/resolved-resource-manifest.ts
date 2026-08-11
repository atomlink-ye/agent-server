import type { WorkOwnerScope } from './work.js';

export type ResourceKind = 'definition' | 'agent' | 'environment' | 'memory' | 'skill';

export interface ResolvedResourceManifestEntry {
  readonly slot: string;
  readonly resourceKind: ResourceKind;
  readonly requestedRef: string | null;
  readonly resolvedVersionId: string;
  readonly resolvedFingerprint: string | null;
  readonly resolvedAt: string;
}

export interface ResolvedResourceManifest {
  readonly workRunId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly entries: readonly ResolvedResourceManifestEntry[];
}

export interface RecordResolvedManifestInput {
  readonly workRunId: string;
  readonly owner: WorkOwnerScope;
  readonly entries: readonly ResolvedResourceManifestEntry[];
}

export class InvalidResolvedManifestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidResolvedManifestError';
  }
}

export function validateManifestEntries(
  entries: readonly ResolvedResourceManifestEntry[],
): void {
  if (entries.length === 0)
    throw new InvalidResolvedManifestError('A resolved manifest must contain at least one entry.');
  const slots = new Set<string>();
  for (const entry of entries) {
    if (!entry.slot || slots.has(entry.slot))
      throw new InvalidResolvedManifestError('Manifest slots must be unique and non-empty.');
    if (!entry.resolvedVersionId)
      throw new InvalidResolvedManifestError('Manifest entries require a resolved version.');
    slots.add(entry.slot);
  }
}
