import {
  RuntimeExecutionError,
  type AgentRuntimeExecuteInput,
  type AgentRuntimeExecution,
  type AgentRuntimeHealth,
  type AgentRuntimePort,
  type RuntimeEventSink,
} from '../../application/ports/agent-runtime.js';

export class UnavailableRuntime implements AgentRuntimePort {
  public async initialize(): Promise<void> {}

  public async execute(
    _input: AgentRuntimeExecuteInput,
    _sink?: RuntimeEventSink,
  ): Promise<AgentRuntimeExecution> {
    throw new RuntimeExecutionError(
      'Runtime execution is unavailable because no runtime adapter is configured.',
    );
  }

  public async cancel(_input: {
    readonly runId: string;
    readonly providerAgentId?: string;
  }): Promise<void> {}

  public async health(): Promise<AgentRuntimeHealth> {
    return {
      ready: false,
      provider: 'none',
      checks: [
        {
          name: 'runtime_adapter',
          ready: false,
          detail: 'No runtime adapter is configured.',
        },
      ],
    };
  }

  public async close(): Promise<void> {}
}
