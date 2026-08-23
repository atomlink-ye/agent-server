import type {
  RuntimeScope,
  RuntimeSession,
  RuntimeSessionId,
  RuntimeSessionOwner,
  RuntimeSessionStatus,
  RuntimeSpecRevision,
} from '../../domain/runtime/runtime-session.js';
import type { RuntimeGenerationId } from '../../domain/runtime/runtime-session.js';

export interface RuntimeSessionStore {
  findById(id: RuntimeSessionId): Promise<RuntimeSession | null>;
  findByScope(
    owner: RuntimeSessionOwner,
    scope: RuntimeScope,
  ): Promise<RuntimeSession | null>;
  create(input: {
    readonly owner: RuntimeSessionOwner;
    readonly scope: RuntimeScope;
    readonly desiredSpecRevision: RuntimeSpecRevision;
    readonly now: string;
  }): Promise<RuntimeSession>;
  updateDesiredRevision(
    id: RuntimeSessionId,
    revision: RuntimeSpecRevision,
    updatedAt: string,
  ): Promise<void>;
  bindCurrentGeneration(
    id: RuntimeSessionId,
    generationId: RuntimeGenerationId,
    updatedAt: string,
  ): Promise<void>;
  markStatus(
    id: RuntimeSessionId,
    status: RuntimeSessionStatus,
    updatedAt: string,
  ): Promise<void>;
  close(id: RuntimeSessionId, closedAt: string): Promise<void>;
}
