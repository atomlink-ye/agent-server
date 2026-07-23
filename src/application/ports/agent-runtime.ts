import type { RunUsage } from '../../domain/runs/run.js';

export interface RuntimeHealthCheck {
  readonly name: string;
  readonly ready: boolean;
  readonly detail?: string;
}

export interface AgentRuntimeHealth {
  readonly ready: boolean;
  readonly provider: string;
  readonly model?: string;
  readonly checks: readonly RuntimeHealthCheck[];
}

export interface AgentRuntimeExecution {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly usage?: RunUsage;
  readonly memoryCandidates?: readonly {
    readonly content: string;
    readonly category: string;
  }[];
}

export interface AgentRuntimePort {
  initialize(): Promise<void>;
  execute(input: {
    readonly runId: string;
    readonly prompt: string;
    readonly memoryCandidates?: {
      readonly maxCandidates?: number;
      readonly proposalLimit?: number;
    };
  }): Promise<AgentRuntimeExecution>;
  cancel?(input: {
    readonly runId: string;
    readonly providerAgentId?: string;
  }): Promise<void>;
  health(): Promise<AgentRuntimeHealth>;
  close(): Promise<void>;
}

export class RuntimeTimedOutError extends Error {
  public constructor(message = 'The runtime execution timed out.') {
    super(message);
    this.name = 'RuntimeTimedOutError';
  }
}

export class RuntimeExecutionError extends Error {
  public constructor(message = 'The runtime execution failed.') {
    super(message);
    this.name = 'RuntimeExecutionError';
  }
}
