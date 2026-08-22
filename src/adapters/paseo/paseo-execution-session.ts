import {
  ExecutionBindingUnavailableError,
  type ExecutionObservationSink,
  type ExecutionResult,
  type ExecutionRunInput,
  type ExecutionSession,
  type ExecutionSessionCapabilities,
  type ExecutionSessionBinding,
  type ExecutionWorkspaceBinding,
} from '../../application/ports/execution-plane.js';
import { PaseoGateway } from './paseo-gateway.js';
import { PaseoTurnRunner } from './paseo-turn-runner.js';

const PASEO_SESSION_CAPABILITIES: ExecutionSessionCapabilities = {
  supported: new Set([
    'reasoning_stream',
    'nested_agent_projection',
    'session_persistence',
  ]),
};

/** Process-local handle for one durable Agent Server RuntimeSession binding. */
export class PaseoExecutionSession implements ExecutionSession {
  public readonly capabilities = PASEO_SESSION_CAPABILITIES;
  #closed = false;

  public constructor(
    public readonly binding: ExecutionSessionBinding,
    public readonly workspaceBinding: ExecutionWorkspaceBinding,
    private readonly metadata: {
      readonly provider: string;
      readonly model: string;
      readonly cwd: string;
      readonly systemPromptBytes: number;
    },
    private readonly gateway: PaseoGateway,
    private readonly turnRunner: PaseoTurnRunner,
  ) {}

  public async run(
    input: ExecutionRunInput,
    observer?: ExecutionObservationSink,
  ): Promise<ExecutionResult> {
    this.#assertOpen();
    return this.turnRunner.run({
      run: input,
      agentId: this.binding.externalSessionId,
      provider: this.metadata.provider,
      model: this.metadata.model,
      cwd: this.metadata.cwd,
      systemPromptBytes: this.metadata.systemPromptBytes,
      ...(observer ? { observer } : {}),
    });
  }

  public async cancel(_runId: string): Promise<void> {
    if (this.#closed) return;
    await this.gateway.cancel(this.binding.externalSessionId);
  }

  /** Deliberately non-destructive: external Paseo Agent/Workspace remain durable. */
  public async close(): Promise<void> {
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed)
      throw new ExecutionBindingUnavailableError(
        'The execution session handle has been closed.',
      );
  }
}
