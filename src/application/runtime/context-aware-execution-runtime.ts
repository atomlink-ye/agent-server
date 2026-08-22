import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import type {
  ExecutionRuntimeService,
  ExecutionTurnRequest,
} from './execution-plane-runtime-facade.js';
import type { ExecutionObservationSink } from '../ports/execution-plane.js';

export interface WorkerRuntimeInvocationResolver {
  resolve(runtimeSessionId: string): Promise<RuntimeInvocationContext | null>;
}

/**
 * Production runtime decorator that adds machine-readable Worker ContextFS
 * facts at the last common runtime seam. Chat already supplies its own
 * invocationContext; this decorator never replaces caller-provided context.
 */
export class ContextAwareExecutionRuntime implements ExecutionRuntimeService {
  public constructor(
    private readonly delegate: ExecutionRuntimeService,
    private readonly workerContext: WorkerRuntimeInvocationResolver,
  ) {}

  ensureReady() {
    return this.delegate.ensureReady();
  }

  ensureAgentChatRuntimeSession(
    input: Parameters<
      NonNullable<ExecutionRuntimeService['ensureAgentChatRuntimeSession']>
    >[0],
  ) {
    if (!this.delegate.ensureAgentChatRuntimeSession)
      throw new Error('Agent Chat RuntimeSession persistence is unavailable.');
    return this.delegate.ensureAgentChatRuntimeSession(input);
  }

  async executeTurn(
    input: ExecutionTurnRequest,
    observer?: ExecutionObservationSink,
  ) {
    if (input.invocationContext || !input.runtimeSessionId)
      return this.delegate.executeTurn(input, observer);

    const invocationContext = await this.workerContext.resolve(
      input.runtimeSessionId,
    );
    return this.delegate.executeTurn(
      invocationContext ? { ...input, invocationContext } : input,
      observer,
    );
  }

  cancelRun(input: Parameters<ExecutionRuntimeService['cancelRun']>[0]) {
    return this.delegate.cancelRun(input);
  }

  planeHealth() {
    return this.delegate.planeHealth();
  }

  close() {
    return this.delegate.close();
  }
}
