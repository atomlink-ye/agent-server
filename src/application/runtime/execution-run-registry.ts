import type {
  ExecutionObservationSink,
  ExecutionResult,
  ExecutionRunInput,
  ExecutionSession,
} from '../ports/execution-plane.js';

/**
 * Process-local active-turn registry. Durable Run state remains in RunRepository;
 * this registry exists only so cancellation can reach the currently attached
 * ExecutionSession without adding a second durable runtime state machine.
 */
export class ExecutionRunRegistry {
  readonly #active = new Map<string, ExecutionSession>();

  public async run(
    session: ExecutionSession,
    input: ExecutionRunInput,
    observer?: ExecutionObservationSink,
  ): Promise<ExecutionResult> {
    if (this.#active.has(input.runId))
      throw new Error(`Execution run ${input.runId} is already active.`);
    this.#active.set(input.runId, session);
    try {
      return await session.run(input, observer);
    } finally {
      if (this.#active.get(input.runId) === session)
        this.#active.delete(input.runId);
    }
  }

  public async cancel(runId: string): Promise<void> {
    const session = this.#active.get(runId);
    if (!session?.cancel) return;
    await session.cancel(runId);
  }

  public cancelRun(input: { readonly runId: string }): Promise<void> {
    return this.cancel(input.runId);
  }

  public has(runId: string): boolean {
    return this.#active.has(runId);
  }
}
