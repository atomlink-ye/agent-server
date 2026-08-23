import type { ExecutionSession } from '../ports/runtime-execution-session.js';
import type { EnsureRuntimeSession } from '../ports/ensure-runtime-session.js';
import type { RuntimeTurnStore } from '../ports/runtime-turn-store.js';
import type { RuntimeTurnId } from '../../domain/runtime/runtime-turn.js';

export interface CancelRuntimeTurnInput {
  readonly turnId: RuntimeTurnId;
}

export class CancelRuntimeTurn {
  public constructor(
    private readonly turns: RuntimeTurnStore,
    private readonly ensureRuntimeSession: EnsureRuntimeSession,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: CancelRuntimeTurnInput): Promise<void> {
    const turn = await this.turns.findById(input.turnId);
    if (
      !turn ||
      turn.status === 'succeeded' ||
      turn.status === 'failed' ||
      turn.status === 'cancelled'
    )
      return;

    if (turn.status === 'pending' || turn.status === 'preparing') {
      await this.turns.cancelBeforeRun({
        id: turn.id,
        completedAt: this.now().toISOString(),
      });
      return;
    }

    const ready = await this.ensureRuntimeSession.execute(
      turn.runtimeSessionId,
    );
    if (ready.generation.id !== turn.generationId)
      throw new Error('runtime_provider_session_missing');
    const session: ExecutionSession = ready.session;
    if (session?.cancel) {
      try {
        await session.cancel(turn.id);
      } catch {
        await session.close().catch(() => undefined);
        throw new Error('runtime_provider_unavailable');
      }
    }
    const cancelled = await this.turns.cancelRunning({
      id: turn.id,
      completedAt: this.now().toISOString(),
    });
    await session.close().catch(() => undefined);
    if (!cancelled) return;
  }
}
