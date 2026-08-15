import type { ExecutionMcpServerConfig } from '../../application/ports/execution-plane.js';
import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import type { RunUsage } from '../../domain/runs/run.js';
import type { PaseoModelDescriptor } from './model-selector.js';
import type { PaseoFinishStatus } from './status-mapper.js';

export interface PaseoCreatedAgent {
  readonly id: string;
  readonly provider: string;
  /** The provider's actual model identity, as returned by createAgent. */
  readonly model: string;
}

export interface PaseoFinishedAgent {
  readonly status: PaseoFinishStatus;
  readonly error: string | null;
  readonly lastMessage: string | null;
  readonly usage?: RunUsage;
}

export interface PaseoAgentStreamEvent {
  readonly agentId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly seq: number | null;
  readonly epoch: string | null;
  readonly timelineItemType: string | null;
  readonly assistantText?: string;
  readonly reasoning?: boolean;
  readonly reasoningText?: string;
  readonly toolCall?: PaseoToolCall;
  readonly permission?: PaseoPermissionActivity;
}

export type PaseoToolDetail =
  | {
      readonly type: 'shell';
      readonly command?: string | undefined;
      readonly cwd?: string | undefined;
      readonly output?: string | undefined;
      readonly exitCode?: number | null | undefined;
    }
  | {
      readonly type: 'read';
      readonly filePath?: string | undefined;
      readonly content?: string | undefined;
      readonly offset?: number | undefined;
      readonly limit?: number | undefined;
    }
  | {
      readonly type: 'edit';
      readonly filePath?: string | undefined;
      readonly oldString?: string | undefined;
      readonly newString?: string | undefined;
      readonly unifiedDiff?: string | undefined;
    }
  | {
      readonly type: 'write';
      readonly filePath?: string | undefined;
      readonly content?: string | undefined;
    }
  | {
      readonly type: 'search';
      readonly query?: string | undefined;
      readonly toolName?: 'search' | 'grep' | 'glob' | 'web_search' | undefined;
      readonly content?: string | undefined;
      readonly filePaths?: readonly string[] | undefined;
      readonly webResults?:
        | readonly {
            readonly title?: string | undefined;
            readonly url?: string | undefined;
          }[]
        | undefined;
      readonly annotations?: readonly string[] | undefined;
      readonly numFiles?: number | undefined;
      readonly numMatches?: number | undefined;
      readonly durationMs?: number | undefined;
      readonly durationSeconds?: number | undefined;
      readonly truncated?: boolean | undefined;
      readonly mode?: 'content' | 'files_with_matches' | 'count' | undefined;
    }
  | {
      readonly type: 'fetch';
      readonly url?: string | undefined;
      readonly prompt?: string | undefined;
      readonly result?: string | undefined;
      readonly code?: number | undefined;
      readonly codeText?: string | undefined;
      readonly bytes?: number | undefined;
      readonly durationMs?: number | undefined;
    }
  | {
      readonly type: 'sub_agent';
      readonly subAgentType?: string | undefined;
      readonly description?: string | undefined;
      /** Internal correlation only; never emitted in RuntimeToolDetail. */
      readonly childSessionId?: string | undefined;
      readonly log?: string | undefined;
      readonly actions?:
        | readonly {
            readonly index?: number | undefined;
            readonly toolName?: string | undefined;
            readonly summary?: string | undefined;
          }[]
        | undefined;
    };

export interface PaseoToolCall {
  readonly callId: string;
  readonly name: string;
  readonly status: string;
  /** Raw provider-supplied title for this tool call, when present. */
  readonly title?: string | undefined;
  /** Internal correlation only; never emitted in RuntimeToolDetail. */
  readonly childSessionId?: string | undefined;
  readonly detail?: PaseoToolDetail;
  readonly resultObserved?: boolean;
  readonly error?: string;
}

export interface PaseoProviderSubagentDescriptor {
  readonly id: string;
  readonly parentAgentId: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly title: string | null;
  readonly description: string | null;
  readonly toolCallId: string | null;
}

export interface PaseoProviderSubagentTimelineItem {
  readonly timelineItemType: string;
  /** Internal correlation only; never emitted downstream. */
  readonly timelineKey?: string;
  readonly reasoning?: boolean;
  readonly reasoningText?: string;
  readonly assistantText?: string;
  readonly toolCall?: PaseoToolCall;
}

export interface PaseoProviderSubagentTimelineRow {
  readonly item: PaseoProviderSubagentTimelineItem;
  readonly timestamp: string;
  readonly seq: number;
}

export interface PaseoProviderSubagentTimeline {
  readonly parentAgentId: string;
  readonly subagentId: string;
  readonly epoch: string;
  readonly direction: 'tail' | 'before' | 'after';
  readonly rows: readonly PaseoProviderSubagentTimelineRow[];
  readonly hasOlder: boolean;
}

export type PaseoProviderSubagentUpdate =
  | {
      readonly kind: 'upsert';
      readonly subagent: PaseoProviderSubagentDescriptor;
    }
  | {
      readonly kind: 'timeline';
      readonly parentAgentId: string;
      readonly subagentId: string;
      readonly epoch: string;
      readonly timestamp: string;
      readonly seq: number;
      readonly item: PaseoProviderSubagentTimelineItem;
    }
  | {
      readonly kind: 'remove';
      readonly parentAgentId: string;
      readonly subagentId: string;
    };

export interface PaseoPermissionActivity {
  readonly requestId: string;
  readonly kind?: string;
  readonly status: 'requested' | 'resolved';
  readonly decision?: 'allowed' | 'denied';
}

export interface PaseoTimelineEntry {
  readonly timelineItemType: string;
  readonly assistantText?: string;
  readonly reasoning?: boolean;
  readonly reasoningText?: string;
  readonly toolCall?: PaseoToolCall;
  readonly timestamp: string;
  readonly seqStart: number;
  readonly seqEnd: number;
}

export interface PaseoTimelinePage {
  readonly epoch: string;
  readonly startCursor: { readonly epoch: string; readonly seq: number } | null;
  readonly endCursor: { readonly epoch: string; readonly seq: number } | null;
  readonly window: {
    readonly minSeq: number;
    readonly maxSeq: number;
    readonly nextSeq: number;
  };
  readonly entries: readonly PaseoTimelineEntry[];
}

export interface PaseoClientPort {
  connect(): Promise<void>;
  connectionStatus(): string;
  openWorkspace(cwd: string): Promise<string>;
  createIndependentWorkspace?(cwd: string): Promise<string>;
  setWorkspaceTitle(workspaceId: string, title: string): Promise<void>;
  listModels(
    provider: ManagedEnvironmentProvider,
    cwd: string,
  ): Promise<readonly PaseoModelDescriptor[]>;
  createAgent(input: {
    readonly provider: ManagedEnvironmentProvider;
    readonly cwd: string;
    readonly workspaceId: string;
    readonly model: string;
    readonly systemPrompt: string;
    readonly initialPrompt: string;
    readonly runId: string;
    readonly title?: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly mcpServers?: readonly ExecutionMcpServerConfig[];
  }): Promise<PaseoCreatedAgent>;
  sendAgentMessage(agentId: string, text: string): Promise<void>;
  subscribeAgentStream?(
    listener: (event: PaseoAgentStreamEvent) => void,
  ): () => void;
  subscribeProviderSubagentUpdates?(
    listener: (update: PaseoProviderSubagentUpdate) => void,
  ): () => void;
  listProviderSubagents?(
    parentAgentId: string,
  ): Promise<readonly PaseoProviderSubagentDescriptor[]>;
  fetchProviderSubagentTimeline?(
    parentAgentId: string,
    subagentId: string,
    options: {
      readonly direction?: 'tail' | 'before' | 'after';
      readonly cursor?: { readonly epoch: string; readonly seq: number };
      readonly limit?: number;
    },
  ): Promise<PaseoProviderSubagentTimeline>;
  fetchAgentTimeline?(
    agentId: string,
    options: {
      readonly direction: 'tail';
      readonly limit: number;
      readonly projection: 'projected';
    },
  ): Promise<PaseoTimelinePage>;
  waitForFinish(
    agentId: string,
    timeoutMs: number,
  ): Promise<PaseoFinishedAgent>;
  cancelAgent?(agentId: string): Promise<void>;
  close(): Promise<void>;
}

export class PaseoClientProjectionError extends Error {
  public constructor(message = 'Paseo returned an invalid projection.') {
    super(message);
    this.name = 'PaseoClientProjectionError';
  }
}
