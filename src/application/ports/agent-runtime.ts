import type { RunUsage } from '../../domain/runs/run.js';
import type { RuntimeMemoryCandidateCategory } from './runtime-memory-candidate-collector.js';

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

export type RuntimeToolDetail =
  | {
      readonly kind: 'shell';
      readonly command?: string;
      readonly cwd?: string;
      readonly output?: string;
      readonly exitCode?: number | null;
    }
  | {
      readonly kind: 'read';
      readonly filePath?: string;
      readonly content?: string;
      readonly offset?: number;
      readonly limit?: number;
    }
  | {
      readonly kind: 'write';
      readonly filePath?: string;
      readonly content?: string;
      readonly error?: string;
    }
  | {
      readonly kind: 'edit';
      readonly filePath?: string;
      readonly oldString?: string;
      readonly newString?: string;
      readonly unifiedDiff?: string;
      readonly error?: string;
    }
  | {
      readonly kind: 'search';
      readonly query?: string;
      readonly toolName?: 'search' | 'grep' | 'glob' | 'web_search';
      readonly content?: string;
      readonly filePaths?: readonly string[];
      readonly webResults?: readonly {
        readonly title?: string;
        readonly url?: string;
      }[];
      readonly annotations?: readonly string[];
      readonly numFiles?: number;
      readonly numMatches?: number;
      readonly durationMs?: number;
      readonly durationSeconds?: number;
      readonly truncated?: boolean;
      readonly mode?: 'content' | 'files_with_matches' | 'count';
      readonly error?: string;
    }
  | {
      readonly kind: 'fetch';
      readonly url?: string;
      readonly prompt?: string;
      readonly result?: string;
      readonly code?: number;
      readonly codeText?: string;
      readonly bytes?: number;
      readonly durationMs?: number;
      readonly error?: string;
    }
  | {
      readonly kind: 'subagent';
      readonly subAgentType?: string;
      readonly description?: string;
      readonly childSessionId?: string;
      readonly log?: string;
      readonly actions?: readonly {
        readonly index?: number;
        readonly toolName?: string;
        readonly summary?: string;
      }[];
      readonly error?: string;
    };

export interface AgentRuntimeExecution {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly providerAgentId: string;
  /** Runtime-owned workspace binding; adapter implementations translate it. */
  readonly runtimeWorkspaceId?: string;
  readonly usage?: RunUsage;
  readonly memoryCandidates?: readonly {
    readonly content: string;
    readonly category: RuntimeMemoryCandidateCategory;
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
      /** Adapter-derived observation that a result-bearing detail field existed. */
      readonly resultObserved?: boolean;
      readonly parentActivityId?: string;
      readonly provider: string;
      readonly detail?: RuntimeToolDetail;
      readonly error?: string;
    }
  | {
      readonly kind: 'child_timeline_item';
      readonly parentActivityId: string;
      readonly activityId: string;
      readonly itemKind: 'assistant' | 'reasoning' | 'tool';
      readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
      readonly label: string;
      readonly summary: string;
      readonly provider: string;
      readonly text?: string;
      readonly detail?: RuntimeToolDetail;
      readonly error?: string;
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
  | ({
      readonly operation: 'create';
      readonly runId: string;
      readonly runtimeSessionId?: string;
      readonly cellCwd?: string;
      readonly runtimeWorkspaceId?: string;
      readonly workspaceTitle?: string;
      readonly agentTitle?: string;
      readonly agentLabels?: Readonly<Record<string, string>>;
      readonly onProviderBinding?: (binding: {
        readonly providerAgentId: string;
        readonly runtimeWorkspaceId: string;
      }) => Promise<void> | void;
      readonly prompt: string;
      readonly systemPrompt: string;
      readonly extensions?: RuntimeExtensionBinding;
      readonly memoryCandidates?: {
        readonly maxCandidates?: number;
        readonly proposalLimit?: number;
      };
    } & (
      | {
          readonly provider?: undefined;
          readonly model?: undefined;
        }
      | {
          readonly provider: string;
          /** Non-empty when supplied by trusted internal model-policy resolution. */
          readonly model: string;
        }
    ))
  | {
      readonly operation: 'continue';
      readonly runId: string;
      readonly prompt: string;
      readonly providerAgentId: string;
      readonly runtimeWorkspaceId?: string;
      readonly runtimeSessionId?: string;
      readonly cellCwd?: string;
      readonly memoryCandidates?: {
        readonly maxCandidates?: number;
        readonly proposalLimit?: number;
      };
    };

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
