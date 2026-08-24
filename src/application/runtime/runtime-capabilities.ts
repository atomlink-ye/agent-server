import type { ExecutionPlaneCapability } from '../ports/execution-plane.js';

/**
 * Runtime capability snapshot used during application composition. It is a
 * value derived before the Runtime is constructed, never a service locator.
 */
export interface RuntimeCapabilities {
  readonly supported: ReadonlySet<ExecutionPlaneCapability>;
}

export function createRuntimeCapabilities(
  supported: Iterable<ExecutionPlaneCapability>,
): RuntimeCapabilities {
  return Object.freeze({ supported: new Set(supported) });
}
