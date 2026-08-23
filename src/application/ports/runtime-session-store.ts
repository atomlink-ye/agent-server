import type {
  RuntimeScope,
  RuntimeSession,
  RuntimeSessionId,
  RuntimeSessionOwner,
  RuntimeSessionStatus,
} from '../../domain/runtime/runtime-session.js';
import type { RuntimeGenerationId } from '../../domain/runtime/runtime-session.js';
import type { RuntimeSessionSpecInput } from '../../domain/runtime/runtime-session-spec.js';

export interface RuntimeSessionStore {
  findById(id: RuntimeSessionId): Promise<RuntimeSession | null>;
  findByScope(
    owner: RuntimeSessionOwner,
    scope: RuntimeScope,
  ): Promise<RuntimeSession | null>;
  createWithInitialSpec(input: {
    readonly owner: RuntimeSessionOwner;
    readonly scope: RuntimeScope;
    readonly spec: Omit<
      RuntimeSessionSpecInput,
      'runtimeSessionId' | 'revision' | 'createdAt'
    >;
    readonly now: string;
  }): Promise<RuntimeSession>;
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
