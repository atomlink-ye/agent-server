import { DaemonClient } from '@getpaseo/client';

import type { RunUsage } from '../../domain/runs/run.js';
import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import type { PaseoFinishStatus } from './status-mapper.js';
import type { PaseoModelDescriptor } from './model-selector.js';
import type { RuntimeMcpServerConfig } from '../../application/ports/agent-runtime.js';

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
    readonly mcpServers?: readonly RuntimeMcpServerConfig[];
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

const PASEO_PROVIDER_DEFAULT_MODE: Readonly<
  Record<ManagedEnvironmentProvider, string>
> = {
  opencode: 'build',
  claude: 'bypassPermissions',
  codex: 'full-access',
};

export class PaseoSdkClient implements PaseoClientPort {
  readonly #client: DaemonClient;

  public constructor(options: {
    readonly url: string;
    readonly connectTimeoutMs: number;
    readonly clientId?: string;
  }) {
    this.#client = new DaemonClient({
      url: options.url,
      clientId: options.clientId ?? `agent-server-${process.pid}`,
      clientType: 'cli',
      appVersion: 'agent-server-baseline/0.1.0',
      connectTimeoutMs: options.connectTimeoutMs,
      reconnect: { enabled: false },
    });
  }

  public connect(): Promise<void> {
    return this.#client.connect();
  }

  public connectionStatus(): string {
    return this.#client.getConnectionState().status;
  }

  public async openWorkspace(cwd: string): Promise<string> {
    const result = await this.#client.openProject(cwd);
    if (!result.workspace) {
      throw new Error(result.error ?? `Paseo could not open workspace: ${cwd}`);
    }
    return result.workspace.id;
  }

  public async createIndependentWorkspace(cwd: string): Promise<string> {
    const result = await this.#client.createWorkspace({
      source: { kind: 'directory', path: cwd },
    });
    if (!result.workspace) {
      throw new Error('Paseo could not create an independent workspace.');
    }
    return result.workspace.id;
  }

  public async setWorkspaceTitle(
    workspaceId: string,
    title: string,
  ): Promise<void> {
    await this.#client.setWorkspaceTitle(workspaceId, title);
  }

  public async listModels(
    provider: ManagedEnvironmentProvider,
    cwd: string,
  ): Promise<readonly PaseoModelDescriptor[]> {
    const result = await this.#client.listProviderModels(provider, { cwd });
    if (result.error) {
      throw new Error(result.error);
    }
    return (result.models ?? []).map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.description ? { description: model.description } : {}),
    }));
  }

  public async createAgent(input: {
    readonly provider: ManagedEnvironmentProvider;
    readonly cwd: string;
    readonly workspaceId: string;
    readonly model: string;
    readonly systemPrompt: string;
    readonly initialPrompt: string;
    readonly runId: string;
    readonly title?: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly mcpServers?: readonly RuntimeMcpServerConfig[];
  }): Promise<PaseoCreatedAgent> {
    const agent = await this.#client.createAgent({
      provider: input.provider,
      model: input.model,
      modeId: PASEO_PROVIDER_DEFAULT_MODE[input.provider],
      cwd: input.cwd,
      workspaceId: input.workspaceId,
      systemPrompt: input.systemPrompt,
      ...(input.title ? { title: input.title } : {}),
      ...(input.mcpServers
        ? {
            mcpServers: Object.fromEntries(
              input.mcpServers.map((server) => [
                server.name,
                {
                  type: 'http',
                  url: server.url,
                  headers: server.headers,
                },
              ]),
            ),
          }
        : {}),
      labels: {
        source: 'agent-server-baseline',
        run_id: input.runId,
        ...input.labels,
      },
    });
    return {
      id: agent.id,
      provider: agent.provider,
      ...(typeof agent.model === 'string' && agent.model
        ? { model: agent.model }
        : (() => {
            throw new Error('Paseo returned an agent without a model.');
          })()),
    };
  }

  public async waitForFinish(
    agentId: string,
    timeoutMs: number,
  ): Promise<PaseoFinishedAgent> {
    const result = await this.#client.waitForFinish(agentId, timeoutMs);
    return {
      status: result.status,
      error: result.error,
      lastMessage: result.lastMessage,
      ...(result.final?.lastUsage ? { usage: result.final.lastUsage } : {}),
    };
  }

  public async sendAgentMessage(agentId: string, text: string): Promise<void> {
    await this.#client.sendAgentMessage(agentId, text);
  }

  public subscribeAgentStream(
    listener: (event: PaseoAgentStreamEvent) => void,
  ): () => void {
    return this.#client.on('agent_stream', (message) => {
      const payload =
        isRecord(message) && isRecord(message.payload) ? message.payload : null;
      const event = payload?.event;
      if (
        !payload ||
        !isRecord(event) ||
        typeof payload.agentId !== 'string' ||
        typeof payload.timestamp !== 'string' ||
        (payload.seq !== undefined &&
          payload.seq !== null &&
          typeof payload.seq !== 'number') ||
        (payload.epoch !== undefined &&
          payload.epoch !== null &&
          typeof payload.epoch !== 'string') ||
        typeof event.type !== 'string'
      )
        return;
      const timelineItem = event.type === 'timeline' ? event.item : undefined;
      if (event.type === 'timeline' && !isRecord(timelineItem)) return;
      const projected = projectStreamEvent(event);
      listener({
        agentId: payload.agentId,
        eventType: event.type,
        timestamp: payload.timestamp,
        seq: payload.seq ?? null,
        epoch: payload.epoch ?? null,
        timelineItemType:
          event.type === 'timeline'
            ? (stringValue(timelineItem?.type) ?? null)
            : null,
        ...(event.type === 'timeline' &&
        timelineItem?.type === 'assistant_message' &&
        typeof timelineItem.text === 'string'
          ? { assistantText: timelineItem.text }
          : {}),
        ...(projected.reasoning ? { reasoning: true } : {}),
        ...(projected.reasoningText
          ? { reasoningText: projected.reasoningText }
          : {}),
        ...(projected.toolCall ? { toolCall: projected.toolCall } : {}),
        ...(projected.permission ? { permission: projected.permission } : {}),
      });
    });
  }

  public subscribeProviderSubagentUpdates(
    listener: (update: PaseoProviderSubagentUpdate) => void,
  ): () => void {
    return this.#client.on('agent.provider_subagents.update', (message) => {
      const update = projectProviderSubagentUpdate(message);
      if (update) listener(update);
    });
  }

  public async listProviderSubagents(
    parentAgentId: string,
  ): Promise<readonly PaseoProviderSubagentDescriptor[]> {
    const payload = await this.#client.listProviderSubagents(parentAgentId);
    if (
      !isRecord(payload) ||
      typeof payload.requestId !== 'string' ||
      payload.parentAgentId !== parentAgentId ||
      !Array.isArray(payload.subagents) ||
      payload.error !== null
    )
      throw new PaseoClientProjectionError(
        'Paseo returned an invalid provider-subagent list.',
      );
    return payload.subagents.flatMap((value) => {
      const descriptor = projectProviderSubagentDescriptor(value);
      return descriptor && descriptor.parentAgentId === parentAgentId
        ? [descriptor]
        : [];
    });
  }

  public async fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
    options: {
      readonly direction?: 'tail' | 'before' | 'after';
      readonly cursor?: { readonly epoch: string; readonly seq: number };
      readonly limit?: number;
    },
  ): Promise<PaseoProviderSubagentTimeline> {
    const payload = await this.#client.fetchProviderSubagentTimeline(
      parentAgentId,
      subagentId,
      options,
    );
    return projectProviderSubagentTimeline(payload, parentAgentId, subagentId);
  }

  public async fetchAgentTimeline(
    agentId: string,
    options: {
      readonly direction: 'tail';
      readonly limit: number;
      readonly projection: 'projected';
    },
  ): Promise<PaseoTimelinePage> {
    const page = await this.#client.fetchAgentTimeline(agentId, options);
    return {
      epoch: page.epoch,
      startCursor: page.startCursor,
      endCursor: page.endCursor,
      window: page.window,
      entries: page.entries.flatMap(
        (rawEntry): readonly PaseoTimelineEntry[] => {
          if (!isRecord(rawEntry) || !isRecord(rawEntry.item)) return [];
          const entry = rawEntry;
          const item = entry.item;
          const timelineItemType = stringValue(item.type);
          if (
            !timelineItemType ||
            typeof entry.timestamp !== 'string' ||
            typeof entry.seqStart !== 'number' ||
            !Number.isFinite(entry.seqStart) ||
            typeof entry.seqEnd !== 'number' ||
            !Number.isFinite(entry.seqEnd)
          )
            return [];
          const projected = projectTimelineItem(item);
          if (timelineItemType === 'assistant_message') {
            const assistantText =
              'text' in item && typeof item.text === 'string'
                ? (projectAssistantText(item.text, 8000) ?? null)
                : null;
            return assistantText !== null
              ? [
                  {
                    timelineItemType,
                    timestamp: entry.timestamp,
                    seqStart: entry.seqStart,
                    seqEnd: entry.seqEnd,
                    assistantText,
                  },
                ]
              : [];
          }
          if (timelineItemType === 'reasoning' && projected.reasoning)
            return [
              {
                timelineItemType,
                timestamp: entry.timestamp,
                seqStart: entry.seqStart,
                seqEnd: entry.seqEnd,
                reasoning: true,
                ...(projected.reasoningText
                  ? { reasoningText: projected.reasoningText }
                  : {}),
              },
            ];
          if (timelineItemType === 'tool_call' && projected.toolCall)
            return [
              {
                timelineItemType,
                timestamp: entry.timestamp,
                seqStart: entry.seqStart,
                seqEnd: entry.seqEnd,
                toolCall: projected.toolCall,
              },
            ];
          return [];
        },
      ),
    };
  }

  public async cancelAgent(agentId: string): Promise<void> {
    await this.#client.cancelAgent(agentId);
  }

  public close(): Promise<void> {
    return this.#client.close();
  }
}

function projectStreamEvent(event: unknown): {
  readonly reasoning?: boolean;
  readonly reasoningText?: string;
  readonly toolCall?: PaseoToolCall;
  readonly permission?: PaseoPermissionActivity;
} {
  if (!isRecord(event)) return {};
  const item = isRecord(event.item) ? event.item : null;
  if (event.type === 'timeline' && item) return projectTimelineItem(item);
  if (event.type === 'tool_call') return projectTimelineItem(event);
  if (event.type === 'permission_requested' && isRecord(event.request)) {
    const id = stringValue(event.request.id);
    const kind = stringValue(event.request.kind);
    return id
      ? {
          permission: {
            requestId: id,
            ...(kind ? { kind } : {}),
            status: 'requested',
          },
        }
      : {};
  }
  if (event.type === 'permission_resolved') {
    const requestId = stringValue(event.requestId);
    const behavior = stringValue(
      event.resolution && isRecord(event.resolution)
        ? event.resolution.behavior
        : undefined,
    );
    return requestId
      ? {
          permission: {
            requestId,
            status: 'resolved',
            ...(behavior === 'allow' ||
            behavior === 'allowed' ||
            behavior === 'allow_once'
              ? { decision: 'allowed' }
              : behavior === 'deny' ||
                  behavior === 'denied' ||
                  behavior === 'reject'
                ? { decision: 'denied' }
                : {}),
          },
        }
      : {};
  }
  return {};
}

export function projectTimelineItem(item: unknown): {
  readonly reasoning?: boolean;
  readonly reasoningText?: string;
  readonly toolCall?: PaseoToolCall;
} {
  if (!isRecord(item)) return {};
  if (item.type === 'reasoning' && typeof item.text === 'string') {
    const text = safePreview(item.text, 4000);
    return { reasoning: true, ...(text ? { reasoningText: text } : {}) };
  }
  if (item.type !== 'tool_call') return {};
  const callId = stringValue(item.callId);
  const name = stringValue(item.name);
  const status = stringValue(item.status);
  if (!callId || !name || !status) return {};
  const projected = projectPaseoToolCall(
    item,
    status.toLowerCase() === 'failed' ? item.error : undefined,
  );
  return {
    ...(projected ? { toolCall: { callId, name, status, ...projected } } : {}),
  };
}

export function projectPaseoToolCall(
  value: unknown,
  failedError?: unknown,
):
  | {
      readonly title?: string | undefined;
      readonly childSessionId?: string | undefined;
      readonly detail?: PaseoToolDetail;
      readonly resultObserved?: boolean;
      readonly error?: string;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const state = isRecord(value.state) ? value.state : undefined;
  const title =
    typeof value.title === 'string' && value.title.trim().length > 0
      ? value.title
      : typeof metadata?.title === 'string' && metadata.title.trim().length > 0
        ? metadata.title
        : typeof state?.title === 'string' && state.title.trim().length > 0
          ? state.title
          : undefined;
  const type = stringValue(
    value.detail && isRecord(value.detail) ? value.detail.type : undefined,
  );
  const resultObserved = hasObservedPaseoResult(value);
  if (!type)
    return {
      ...(title ? { title } : {}),
      ...(resultObserved ? { resultObserved: true } : {}),
      ...(typeof failedError === 'string' ? { error: failedError } : {}),
    };
  const raw = value.detail;
  if (!isRecord(raw))
    return {
      ...(title ? { title } : {}),
      ...(resultObserved ? { resultObserved: true } : {}),
      ...(typeof failedError === 'string' ? { error: failedError } : {}),
    };
  const stringField = (key: string): string | undefined =>
    typeof raw[key] === 'string' ? (raw[key] as string) : undefined;
  const finiteNumber = (key: string): number | undefined =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key])
      ? (raw[key] as number)
      : undefined;
  const booleanField = (key: string): boolean | undefined =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : undefined;
  const strings = (key: string): readonly string[] | undefined =>
    Array.isArray(raw[key])
      ? raw[key].filter((item): item is string => typeof item === 'string')
      : undefined;
  const webResults = Array.isArray(raw.webResults)
    ? raw.webResults.filter(isRecord).map((item) => ({
        ...(typeof item.title === 'string' ? { title: item.title } : {}),
        ...(typeof item.url === 'string' ? { url: item.url } : {}),
      }))
    : undefined;
  const annotations = Array.isArray(raw.annotations)
    ? raw.annotations.filter((item): item is string => typeof item === 'string')
    : undefined;
  const actions = Array.isArray(raw.actions)
    ? raw.actions.filter(isRecord).map((item) => ({
        ...(typeof item.index === 'number' && Number.isFinite(item.index)
          ? { index: item.index }
          : {}),
        ...(typeof item.toolName === 'string'
          ? { toolName: item.toolName }
          : {}),
        ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
      }))
    : undefined;
  let detail: PaseoToolDetail | undefined;
  if (type === 'shell')
    detail = {
      type,
      ...(stringField('command') ? { command: stringField('command') } : {}),
      ...(stringField('cwd') ? { cwd: stringField('cwd') } : {}),
      ...(stringField('output') ? { output: stringField('output') } : {}),
      ...(typeof raw.exitCode === 'number' && Number.isFinite(raw.exitCode)
        ? { exitCode: raw.exitCode }
        : raw.exitCode === null
          ? { exitCode: null }
          : {}),
    };
  else if (type === 'read')
    detail = {
      type,
      ...(stringField('filePath') ? { filePath: stringField('filePath') } : {}),
      ...(stringField('content') ? { content: stringField('content') } : {}),
      ...(finiteNumber('offset') !== undefined
        ? { offset: finiteNumber('offset') }
        : {}),
      ...(finiteNumber('limit') !== undefined
        ? { limit: finiteNumber('limit') }
        : {}),
    };
  else if (type === 'edit')
    detail = {
      type,
      ...(stringField('filePath') ? { filePath: stringField('filePath') } : {}),
      ...(stringField('oldString')
        ? { oldString: stringField('oldString') }
        : {}),
      ...(stringField('newString')
        ? { newString: stringField('newString') }
        : {}),
      ...(stringField('unifiedDiff')
        ? { unifiedDiff: stringField('unifiedDiff') }
        : {}),
    };
  else if (type === 'write')
    detail = {
      type,
      ...(stringField('filePath') ? { filePath: stringField('filePath') } : {}),
      ...(stringField('content') ? { content: stringField('content') } : {}),
    };
  else if (type === 'search') {
    const toolName = stringField('toolName');
    const mode = stringField('mode');
    detail = {
      type,
      ...(stringField('query') ? { query: stringField('query') } : {}),
      ...(toolName === 'search' ||
      toolName === 'grep' ||
      toolName === 'glob' ||
      toolName === 'web_search'
        ? { toolName }
        : {}),
      ...(stringField('content') ? { content: stringField('content') } : {}),
      ...(strings('filePaths') ? { filePaths: strings('filePaths') } : {}),
      ...(webResults ? { webResults } : {}),
      ...(annotations ? { annotations } : {}),
      ...(finiteNumber('numFiles') !== undefined
        ? { numFiles: finiteNumber('numFiles') }
        : {}),
      ...(finiteNumber('numMatches') !== undefined
        ? { numMatches: finiteNumber('numMatches') }
        : {}),
      ...(finiteNumber('durationMs') !== undefined
        ? { durationMs: finiteNumber('durationMs') }
        : {}),
      ...(finiteNumber('durationSeconds') !== undefined
        ? { durationSeconds: finiteNumber('durationSeconds') }
        : {}),
      ...(booleanField('truncated') !== undefined
        ? { truncated: booleanField('truncated') }
        : {}),
      ...(mode === 'content' ||
      mode === 'files_with_matches' ||
      mode === 'count'
        ? { mode }
        : {}),
    };
  } else if (type === 'fetch')
    detail = {
      type,
      ...(stringField('url') ? { url: stringField('url') } : {}),
      ...(stringField('prompt') ? { prompt: stringField('prompt') } : {}),
      ...(stringField('result') ? { result: stringField('result') } : {}),
      ...(finiteNumber('code') !== undefined
        ? { code: finiteNumber('code') }
        : {}),
      ...(stringField('codeText') ? { codeText: stringField('codeText') } : {}),
      ...(finiteNumber('bytes') !== undefined
        ? { bytes: finiteNumber('bytes') }
        : {}),
      ...(finiteNumber('durationMs') !== undefined
        ? { durationMs: finiteNumber('durationMs') }
        : {}),
    };
  else if (type === 'sub_agent')
    detail = {
      type,
      ...(stringField('subAgentType')
        ? { subAgentType: stringField('subAgentType') }
        : {}),
      ...(stringField('description')
        ? { description: stringField('description') }
        : {}),
      ...(stringField('log') ? { log: stringField('log') } : {}),
      ...(actions ? { actions } : {}),
    };
  return {
    ...(title ? { title } : {}),
    ...(type === 'sub_agent' && stringField('childSessionId')
      ? { childSessionId: stringField('childSessionId') }
      : {}),
    ...(detail ? { detail } : {}),
    ...(resultObserved ? { resultObserved: true } : {}),
    ...(typeof failedError === 'string' ? { error: failedError } : {}),
  };
}

function hasObservedPaseoResult(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 2) return false;
  for (const field of [
    'output',
    'result',
    'content',
    'structuredContent',
    'log',
    'error',
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(value, field) &&
      value[field] !== undefined
    )
      return true;
  }
  for (const container of ['detail', 'state', 'response', 'metadata']) {
    if (
      isRecord(value[container]) &&
      hasObservedPaseoResult(value[container], depth + 1)
    )
      return true;
  }
  return false;
}

function safePreview(value: string, max: number): string | undefined {
  const sanitized = value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,
    '',
  );
  if (!sanitized.trim() || containsCredentialMarker(sanitized))
    return undefined;
  return Array.from(sanitized).slice(0, max).join('');
}

function projectAssistantText(value: string, max: number): string | undefined {
  const projected = value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,
    '',
  );
  if (!projected.trim()) return undefined;
  return Array.from(projected).slice(0, max).join('');
}

function containsCredentialMarker(value: string): boolean {
  return (
    /authorization|cookie|password|secret|token|credential|api[_-]?key|private[ _-]?key|bearer\s+/i.test(
      value,
    ) || /:\/\/[^/?#:@]+:[^@]+@/i.test(value)
  );
}

function projectProviderSubagentDescriptor(
  value: unknown,
): PaseoProviderSubagentDescriptor | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const parentAgentId = stringValue(value.parentAgentId);
  const status = normalizeSubagentStatus(value.status);
  const provider = stringValue(value.provider);
  const createdAt = stringValue(value.createdAt);
  const updatedAt = stringValue(value.updatedAt);
  const title = requiredNullableString(value.title);
  const description = requiredNullableString(value.description);
  const toolCallId = requiredNullableString(value.toolCallId);
  if (
    !id ||
    !parentAgentId ||
    !status ||
    !provider ||
    !createdAt ||
    !updatedAt ||
    !title.valid ||
    !description.valid ||
    !toolCallId.valid
  )
    return null;
  return {
    id,
    parentAgentId,
    status,
    title: title.value,
    description: description.value,
    toolCallId: toolCallId.value,
  };
}

function projectProviderSubagentTimeline(
  value: unknown,
  parentAgentId: string,
  subagentId: string,
): PaseoProviderSubagentTimeline {
  if (
    !isRecord(value) ||
    value.parentAgentId !== parentAgentId ||
    value.subagentId !== subagentId
  )
    throw new PaseoClientProjectionError(
      'Paseo returned an invalid provider-subagent timeline identity.',
    );
  const epoch = stringValue(value.epoch);
  const direction = directionValue(value.direction);
  const rows = Array.isArray(value.rows)
    ? value.rows.flatMap((row) => {
        if (!isRecord(row)) return [];
        const item = projectProviderSubagentTimelineItem(row.item);
        const timestamp = stringValue(row.timestamp);
        const seq = nonNegativeNumber(row.seq);
        return item && timestamp && seq !== null
          ? [{ item, timestamp, seq }]
          : [];
      })
    : null;
  if (
    typeof value.requestId !== 'string' ||
    epoch === undefined ||
    direction === null ||
    (typeof value.provider !== 'string' && value.provider !== null) ||
    typeof value.reset !== 'boolean' ||
    typeof value.staleCursor !== 'boolean' ||
    typeof value.gap !== 'boolean' ||
    !isTimelineWindow(value.window) ||
    typeof value.hasOlder !== 'boolean' ||
    typeof value.hasNewer !== 'boolean' ||
    rows === null ||
    value.error !== null
  )
    throw new PaseoClientProjectionError(
      'Paseo returned an invalid provider-subagent timeline.',
    );
  return {
    parentAgentId,
    subagentId,
    epoch,
    direction,
    rows,
    hasOlder: value.hasOlder,
  };
}

function projectProviderSubagentTimelineItem(
  value: unknown,
): PaseoProviderSubagentTimelineItem | null {
  if (!isRecord(value)) return null;
  const timelineItemType = stringValue(value.type);
  if (!timelineItemType) return null;
  // Paseo's assistant reducer treats messageId as a semantic boundary. Do not
  // use the provider's per-token item id here: it would split one stream into
  // one product row per token.
  const timelineKey = stringValue(value.messageId);
  const projected = projectTimelineItem(value);
  if (timelineItemType === 'reasoning' && projected.reasoning)
    return {
      timelineItemType,
      ...(timelineKey ? { timelineKey } : {}),
      reasoning: true,
      ...(projected.reasoningText
        ? { reasoningText: projected.reasoningText }
        : {}),
    };
  if (timelineItemType === 'tool_call' && projected.toolCall)
    return {
      timelineItemType,
      ...(timelineKey ? { timelineKey } : {}),
      toolCall: projected.toolCall,
    };
  if (
    timelineItemType === 'assistant_message' &&
    typeof value.text === 'string'
  )
    return {
      timelineItemType,
      ...(timelineKey ? { timelineKey } : {}),
      ...(projectAssistantText(value.text, 8000)
        ? { assistantText: projectAssistantText(value.text, 8000)! }
        : {}),
    };
  return null;
}

function projectProviderSubagentUpdate(
  value: unknown,
): PaseoProviderSubagentUpdate | null {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  const payload = value.payload;
  if (payload.kind === 'upsert') {
    const subagent = projectProviderSubagentDescriptor(payload.subagent);
    return subagent ? { kind: 'upsert', subagent } : null;
  }
  if (payload.kind === 'remove') {
    const parentAgentId = stringValue(payload.parentAgentId);
    const subagentId = stringValue(payload.subagentId);
    return parentAgentId && subagentId
      ? { kind: 'remove', parentAgentId, subagentId }
      : null;
  }
  if (payload.kind !== 'timeline') return null;
  const parentAgentId = stringValue(payload.parentAgentId);
  const subagentId = stringValue(payload.subagentId);
  const epoch = stringValue(payload.epoch);
  const timestamp = stringValue(payload.timestamp);
  const seq = nonNegativeNumber(payload.seq);
  const item = projectProviderSubagentTimelineItem(payload.item);
  return parentAgentId &&
    subagentId &&
    epoch &&
    timestamp &&
    typeof payload.provider === 'string' &&
    seq !== null &&
    item
    ? {
        kind: 'timeline',
        parentAgentId,
        subagentId,
        epoch,
        timestamp,
        seq,
        item,
      }
    : null;
}

function normalizeSubagentStatus(
  value: unknown,
): PaseoProviderSubagentDescriptor['status'] | null {
  if (value === 'running') return 'running';
  if (value === 'completed') return 'completed';
  if (value === 'failed') return 'failed';
  if (value === 'canceled' || value === 'cancelled') return 'cancelled';
  return null;
}

function requiredNullableString(value: unknown): {
  readonly valid: boolean;
  readonly value: string | null;
} {
  return value === null
    ? { valid: true, value: null }
    : typeof value === 'string'
      ? { valid: true, value }
      : { valid: false, value: null };
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function directionValue(value: unknown): 'tail' | 'before' | 'after' | null {
  return value === 'tail' || value === 'before' || value === 'after'
    ? value
    : null;
}

function isTimelineWindow(value: unknown): value is {
  readonly minSeq: number;
  readonly maxSeq: number;
  readonly nextSeq: number;
} {
  return (
    isRecord(value) &&
    nonNegativeNumber(value.minSeq) !== null &&
    nonNegativeNumber(value.maxSeq) !== null &&
    nonNegativeNumber(value.nextSeq) !== null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
