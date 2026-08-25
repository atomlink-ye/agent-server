import {
  canonicalizeManagedAgentJson,
  parseManagedAgentPackage,
  type ManagedAgentPackage,
  type ParsedManagedAgentPackage,
} from '../agents/managed-agent-package.js';

export type WorkerPackage = Omit<ManagedAgentPackage, 'kind'> & {
  readonly kind: 'Worker';
};

export interface ParsedWorkerPackage {
  readonly package: WorkerPackage;
  readonly canonicalJson: string;
  readonly fingerprint: string;
  readonly normalizedName: string;
  readonly compiler: ParsedManagedAgentPackage['compiler'];
}

export class WorkerPackageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkerPackageError';
  }
}

/**
 * Worker v1 intentionally reuses the hardened executable package grammar that
 * historically lived under ManagedAgent. The only semantic change at this
 * boundary is the resource kind: Workers are formal Work execution roles and
 * can never become Coworker/Chat identities as a publication side effect.
 *
 * Keeping the executable fingerprint stable lets historical Work participants
 * move into the Worker namespace without pretending their executable payload
 * changed merely because its product type is now explicit.
 */
export function parseWorkerPackage(source: string): ParsedWorkerPackage {
  if (typeof source !== 'string' || !/^\s*apiVersion:/m.test(source))
    throw new WorkerPackageError('invalid_worker_source');
  const kindMatches = [...source.matchAll(/^kind\s*:\s*([^#\r\n]+?)\s*$/gim)];
  if (kindMatches.length !== 1 || kindMatches[0]?.[1]?.trim() !== 'Worker')
    throw new WorkerPackageError('invalid_worker_kind');
  const managedSource = source.replace(
    /^(kind[ \t]*:[ \t]*)Worker([ \t]*)$/im,
    '$1ManagedAgent$2',
  );
  const parsed = parseManagedAgentPackage(managedSource);
  const packageValue = deepFreeze({
    ...parsed.package,
    kind: 'Worker' as const,
  }) as WorkerPackage;
  return {
    package: packageValue,
    canonicalJson: canonicalizeManagedAgentJson(packageValue),
    fingerprint: parsed.fingerprint,
    normalizedName: parsed.normalizedName,
    compiler: parsed.compiler,
  };
}

export function rehydrateWorkerPackage(value: WorkerPackage): WorkerPackage {
  return deepFreeze(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
