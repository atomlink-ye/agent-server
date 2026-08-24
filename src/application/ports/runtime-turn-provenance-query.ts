import type {
  RuntimeSessionId,
  RuntimeTurnId,
} from '../../domain/runtime/runtime-session.js';
import type { RuntimeTurn } from '../../domain/runtime/runtime-turn.js';

export interface RuntimeTurnProvenanceQuery {
  /** Reads the one active durable turn attached to a technical Run. */
  findActiveRunTurn(runId: string): Promise<RuntimeTurn | null>;

  findSucceededRunTurn(input: {
    readonly runId: string;
    readonly productSessionId: string;
  }): Promise<{
    readonly turnId: RuntimeTurnId;
    readonly runtimeSessionId: RuntimeSessionId;
  } | null>;
}
