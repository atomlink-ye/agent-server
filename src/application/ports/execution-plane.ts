import type { RunUsage } from '../../domain/runs/run.js';

export const AGENT_SERVER_EXECUTION_MCP_SERVER_NAME = 'agent-server';

export type ExecutionPlaneCapability =
  | 'streaming'
  | 'cancellation'
  | 'reusable_session'
  | 'external_workspace'
  | 'timeline_replay'
  | 'permissions'
  | 'nested_activities'
  | 'provider_discovery'
  | 'platform_mcp';

export type ExecutionSessionCapability =
  | 'permission_response'
  | 'reasoning_stream'
  | 'rewind'
  | 'nested_agent_projection'
  | 'session_persistence';

export interface ExecutionPlaneCapabilities {
  readonly supported: ReadonlySet<ExecutionPlaneCapability>;
}

export interface ExecutionSessionCapabilities {
  readonly supported: ReadonlySet<ExecutionSessionCapability>;
}

export interface ExecutionPlaneHealthCheck {
  readonly name: string;
  readonly ready: boolean;
  readonly detail?: string;
}

export interface ExecutionPlaneHealth {
  readonly ready: boolean;
  readonly plane: string;
  readonly provider?: string;
  readonly model?: string;
  readonly checks: readonly ExecutionPlaneHealthCheck[];
}

export interface ExecutionWorkspaceBinding {
  readonly plane: string;
  readonly externalWorkspaceId: string;
}

export interface ExecutionSessionBinding {
  readonly plane: string;
  readonly externalSessionId: string;
}

export interface ExecutionMcpServerConfig {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ExecutionExtensionBinding {
  readonly mcpServers?: readonly ExecutionMcpServerConfig[];
}

export interface ExecutionWorkspaceSpec {
  readonly cwd: string;
  readonly binding?: ExecutionWorkspaceBinding;
  readonly title?: string;
}

export interface ExecutionSessionSpec {
  /** Agent Server durable identity. It must exist before createSession is called. */
  readonly runtimeSessionId: string;
  readonly workspace: ExecutionWorkspaceSpec;
  readonly provider?: string;
  readonly model?: string;
  readonly systemPrompt: string;
  readonly title?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: ExecutionExtensionBinding;
}

export interface CreatedExecutionSession {
  readonly session: ExecutionSession;
  readonly workspaceBinding: ExecutionWorkspaceBinding;
  readonly sessionBinding: ExecutionSessionBinding;
}

export interface ExecutionRunInput {
  readonly runId: string;
  readonly prompt: string;
}

export type ExecutionToolCategory =
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'fetch'
  | 'subagent'
  | 'other';

export type ExecutionToolStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Safe, execution-oriented tool detail. Implementations must strip raw provider
 * payloads, credentials and host-only identities before emitting it.
 */
export type ExecutionToolDetail =
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
      readonly log?: string;
      readonly actions?: readonly {
        readonly index?: number;
        readonly toolName?: string;
        readonly summary?: string;
      }[];
      readonly error?: string;
    };

export type ExecutionObservation =
  | { readonly kind: 'turn_started'; readonly runId: string }
  | { readonly kind: 'assistant_updated'; readonly text: string }
  | {
      readonly kind: 'reasoning_updated';
      readonly status: 'started' | 'completed';
      readonly text?: string | undefined;
    }
  | {
      readonly kind: 'tool_updated';
      readonly activityId: string;
      readonly category: ExecutionToolCategory;
      readonly status: ExecutionToolStatus;
      readonly label: string;
      readonly summary: string;
      readonly toolName?: string | undefined;
      readonly resultObserved?: boolean | undefined;
      readonly parentActivityId?: string | undefined;
      readonly provider: string;
      readonly detail?: ExecutionToolDetail | undefined;
      readonly error?: string | undefined;
    }
  | {
      readonly kind: 'child_activity_updated';
      readonly parentActivityId: string;
      readonly activityId: string;
      readonly itemKind: 'assistant' | 'reasoning' | 'tool';
      readonly status: ExecutionToolStatus;
      readonly label: string;
      readonly summary: string;
      readonly provider: string;
      readonly text?: string | undefined;
      readonly detail?: ExecutionToolDetail | undefined;
      readonly error?: string | undefined;
    }
  | {
      readonly kind: 'permission_updated';
      readonly activityId: string;
      readonly category: 'tool' | 'plan' | 'question' | 'mode' | 'other';
      readonly status: 'requested' | 'resolved';
      readonly decision?: 'allowed' | 'denied' | undefined;
      readonly summary: string;
    }
  | {
      readonly kind: 'usage_updated';
      readonly usage: RunUsage;
    }
  | {
      readonly kind: 'turn_completed';
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly kind: 'turn_failed';
      readonly failure: ExecutionFailure;
    };

export interface ExecutionObservationSink {
  emit(observation: ExecutionObservation): Promise<void> | void;
}

export interface ExecutionOutput {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly usage?: RunUsage;
}

export interface ExecutionFailure {
  readonly code: string;
  readonly message: string;
}

export type ExecutionResult =
  | { readonly status: 'completed'; readonly output: ExecutionOutput }
  | { readonly status: 'failed'; readonly failure: ExecutionFailure }
  | { readonly status: 'cancelled' };

export interface ExecutionSession {
  readonly capabilities: ExecutionSessionCapabilities;
  run(
    input: ExecutionRunInput,
    observer?: ExecutionObservationSink,
  ): Promise<ExecutionResult>;
  cancel?(runId: string): Promise<void>;
  /** Releases only process-local handles. It must not archive external state. */
  close(): Promise<void>;
}

export interface ExecutionPlanePort {
  capabilities(): ExecutionPlaneCapabilities;
  createSession(spec: ExecutionSessionSpec): Promise<CreatedExecutionSession>;
  attachSession(
    binding: ExecutionSessionBinding,
    spec: ExecutionSessionSpec,
  ): Promise<ExecutionSession>;
  health(): Promise<ExecutionPlaneHealth>;
  close(): Promise<void>;
}

export class ExecutionPlaneUnavailableError extends Error {
  public constructor(message = 'The execution plane is unavailable.') {
    super(message);
    this.name = 'ExecutionPlaneUnavailableError';
  }
}

export class ExecutionBindingUnavailableError extends Error {
  public constructor(message = 'The execution binding is unavailable.') {
    super(message);
    this.name = 'ExecutionBindingUnavailableError';
  }
}

export class UnsupportedCapabilityError extends Error {
  public constructor(message = 'The required execution capability is unavailable.') {
    super(message);
    this.name = 'UnsupportedCapabilityError';
  }
}

export class ProtocolViolationError extends Error {
  public constructor(message = 'The execution plane returned an invalid protocol projection.') {
    super(message);
    this.name = 'ProtocolViolationError';
  }
}

export function supportsPlaneCapability(
  capabilities: ExecutionPlaneCapabilities,
  capability: ExecutionPlaneCapability,
): boolean {
  return capabilities.supported.has(capability);
}

export function supportsSessionCapability(
  capabilities: ExecutionSessionCapabilities,
  capability: ExecutionSessionCapability,
): boolean {
  return capabilities.supported.has(capability);
}
