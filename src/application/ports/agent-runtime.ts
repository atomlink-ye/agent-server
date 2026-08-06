import type { RunUsage } from '../../domain/runs/run.js';

export const AGENT_SERVER_RUNTIME_MCP_SERVER_NAME = 'agent-server';

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

export interface RuntimeMcpServerConfig {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface RuntimeExtensionBinding {
  readonly mcpServers?: readonly RuntimeMcpServerConfig[];
}

export interface AgentRuntimeExecution {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly providerAgentId: string;
  readonly paseoWorkspaceId?: string;
  readonly usage?: RunUsage;
  readonly memoryCandidates?: readonly {
    readonly content: string;
    readonly category: string;
  }[];
}

export type RuntimeEvent =
  | { readonly kind: 'assistant_text'; readonly text: string }
  | {
      readonly kind: 'reasoning_progress';
      readonly status: 'started' | 'completed';
      readonly text?: string;
    }
  | {
      readonly kind: 'tool_status';
      readonly activityId: string;
      readonly category:
        | 'shell'
        | 'read'
        | 'edit'
        | 'write'
        | 'search'
        | 'fetch'
        | 'subagent'
        | 'other';
      readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
      readonly label: string;
      readonly summary: string;
      readonly toolName?: string | undefined;
      readonly parentActivityId?: string;
      readonly detailKind?:
        'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch';
      readonly detailText?: string;
      readonly exitCode?: number;
    }
  | {
      readonly kind: 'child_timeline_item';
      readonly parentActivityId: string;
      readonly activityId: string;
      readonly itemKind: 'assistant' | 'reasoning' | 'tool';
      readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
      readonly label: string;
      readonly summary: string;
      readonly detailKind?:
        'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch';
      readonly detailText?: string;
      readonly exitCode?: number;
    }
  | {
      readonly kind: 'usage';
      readonly totalCostUsd?: number;
      readonly inputTokens?: number;
      readonly cachedInputTokens?: number;
      readonly outputTokens?: number;
      readonly contextWindowMaxTokens?: number;
      readonly contextWindowUsedTokens?: number;
    }
  | {
      readonly kind: 'permission';
      readonly activityId: string;
      readonly category: 'tool' | 'plan' | 'question' | 'mode' | 'other';
      readonly status: 'requested' | 'resolved';
      readonly decision?: 'allowed' | 'denied';
      readonly summary: string;
    };

export interface RuntimeEventSink {
  emit(event: RuntimeEvent): Promise<void> | void;
}

export type AgentRuntimeExecuteInput =
  | {
      readonly operation: 'create';
      readonly runId: string;
      readonly runtimeSessionId?: string;
      readonly cellCwd?: string;
      readonly paseoWorkspaceId?: string;
      readonly workspaceTitle?: string;
      readonly agentTitle?: string;
      readonly agentLabels?: Readonly<Record<string, string>>;
      readonly onProviderBinding?: (binding: {
        readonly providerAgentId: string;
        readonly paseoWorkspaceId: string;
      }) => Promise<void> | void;
      readonly prompt: string;
      readonly systemPrompt: string;
      readonly extensions?: RuntimeExtensionBinding;
      readonly memoryCandidates?: {
        readonly maxCandidates?: number;
        readonly proposalLimit?: number;
      };
    }
  | {
      readonly operation: 'continue';
      readonly runId: string;
      readonly prompt: string;
      readonly providerAgentId: string;
      readonly paseoWorkspaceId?: string;
      readonly runtimeSessionId?: string;
      readonly cellCwd?: string;
      readonly memoryCandidates?: {
        readonly maxCandidates?: number;
        readonly proposalLimit?: number;
      };
    };

export interface AgentRuntimePort {
  initialize(): Promise<void>;
  execute(
    input: AgentRuntimeExecuteInput,
    sink?: RuntimeEventSink,
  ): Promise<AgentRuntimeExecution>;
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
