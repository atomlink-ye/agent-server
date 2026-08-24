import type { RuntimeTurnId } from '../../domain/runtime/runtime-session.js';

/** Releases a turn binding while preserving the generation grant lineage. */
export interface ReleaseRuntimeGrant {
  releaseForTurn(runtimeTurnId: RuntimeTurnId): Promise<void>;
}
