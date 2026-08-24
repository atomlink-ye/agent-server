import type {
  RuntimeGenerationId,
  RuntimeSessionId,
  RuntimeTurnId,
} from '../../domain/runtime/runtime-session.js';

/** Durable grant revocation owned by the runtime authority. */
export interface RevokeRuntimeGrants {
  revokeForGeneration(generationId: RuntimeGenerationId): Promise<void>;
  revokeForTurn(runtimeTurnId: RuntimeTurnId): Promise<void>;
  revokeForSession(runtimeSessionId: RuntimeSessionId): Promise<void>;
}
