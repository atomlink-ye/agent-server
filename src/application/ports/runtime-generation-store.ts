import type {
  RuntimeGenerationId,
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../domain/runtime/runtime-session.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';

export interface RuntimeGenerationStore {
  findById(id: RuntimeGenerationId): Promise<RuntimeSessionGeneration | null>;
  findCurrent(
    sessionId: RuntimeSessionId,
  ): Promise<RuntimeSessionGeneration | null>;
  insert(generation: RuntimeSessionGeneration): Promise<void>;
  updateAppliedSpec(input: {
    readonly id: RuntimeGenerationId;
    readonly appliedSpecRevision: RuntimeSpecRevision;
    readonly appliedBootstrapDigest: string;
  }): Promise<void>;
  supersede(input: {
    readonly id: RuntimeGenerationId;
    readonly supersededAt: string;
  }): Promise<void>;
}

/** Explicit transaction boundary for atomically replacing the current binding. */
export interface RuntimeGenerationTransaction {
  replaceCurrentGeneration(input: {
    readonly sessionId: RuntimeSessionId;
    readonly previousGenerationId: RuntimeGenerationId | null;
    /** Provider binding facts are inserted only after the session lock/CAS. */
    readonly generation: {
      readonly id: RuntimeGenerationId;
      readonly provider: string;
      readonly providerWorkspaceId: string | null;
      readonly providerSessionId: string;
      readonly appliedSpecRevision: RuntimeSpecRevision;
      readonly appliedBootstrapDigest: string;
      readonly endpointEpoch: string;
      readonly createdAt: string;
      readonly readyAt: string;
    };
  }): Promise<void>;
}
