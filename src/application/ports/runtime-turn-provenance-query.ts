import type {
  RuntimeSessionId,
  RuntimeTurnId,
} from '../../domain/runtime/runtime-session.js';

export interface RuntimeTurnProvenanceQuery {
  findSucceededRunTurn(input: {
    readonly runId: string;
    readonly productSessionId: string;
  }): Promise<{
    readonly turnId: RuntimeTurnId;
    readonly runtimeSessionId: RuntimeSessionId;
  } | null>;
}
