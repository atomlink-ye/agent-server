import type {
  RuntimeFailureCode,
  RuntimeTurn,
  RuntimeTurnId,
  RuntimeTurnSource,
} from '../../domain/runtime/runtime-turn.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
} from '../../domain/runtime/runtime-session.js';

export interface RuntimeTurnStore {
  createPending(input: {
    readonly id?: RuntimeTurnId;
    readonly runtimeSessionId: RuntimeSessionId;
    readonly source: RuntimeTurnSource;
    readonly promptDigest: string | null;
    readonly createdAt: string;
  }): Promise<RuntimeTurn>;

  findById(id: RuntimeTurnId): Promise<RuntimeTurn | null>;

  /** Atomically binds a ready generation and moves pending to preparing. */
  bindGenerationAndPrepare(input: {
    readonly id: RuntimeTurnId;
    readonly generationId: RuntimeGenerationId;
  }): Promise<RuntimeTurn | false>;

  /** Atomically moves preparing to running. */
  start(input: {
    readonly id: RuntimeTurnId;
    readonly startedAt: string;
  }): Promise<RuntimeTurn | false>;

  /** Atomically completes a running turn. Cancellation wins this CAS. */
  succeed(input: {
    readonly id: RuntimeTurnId;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false>;

  /** Atomically fails any non-terminal turn. */
  fail(input: {
    readonly id: RuntimeTurnId;
    readonly failureCode: RuntimeFailureCode;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false>;

  /** Durable cancellation before a provider run begins. */
  cancelBeforeRun(input: {
    readonly id: RuntimeTurnId;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false>;

  /** Durable cancellation for an active provider run. */
  cancelRunning(input: {
    readonly id: RuntimeTurnId;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false>;
}
