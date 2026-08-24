import type { RuntimeTurnProvenanceQuery } from '../ports/runtime-turn-provenance-query.js';
import type { RuntimeTurnId } from '../../domain/runtime/runtime-turn.js';

export interface CancelRuntimeTurnUseCase {
  execute(input: { readonly turnId: RuntimeTurnId }): Promise<void>;
}

/** Resolves a technical Run to its active durable turn before cancellation. */
export class CancelRuntimeRun {
  public constructor(
    private readonly turns: Pick<
      RuntimeTurnProvenanceQuery,
      'findActiveRunTurn'
    >,
    private readonly cancelTurn: CancelRuntimeTurnUseCase,
  ) {}

  public async cancelRun(input: { readonly runId: string }): Promise<void> {
    const turn = await this.turns.findActiveRunTurn(input.runId);
    if (turn) await this.cancelTurn.execute({ turnId: turn.id });
  }
}
