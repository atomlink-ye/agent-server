import { DaemonClient } from '@getpaseo/client';

import type { RunUsage } from '../../domain/runs/run.js';
import type { PaseoFinishStatus } from './status-mapper.js';
import type { PaseoModelDescriptor } from './model-selector.js';
import type { RuntimeMcpServerConfig } from '../../application/ports/agent-runtime.js';

export interface PaseoCreatedAgent {
  readonly id: string;
  readonly provider: string;
  readonly model: string | null;
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
}

export interface PaseoTimelineEntry {
  readonly timelineItemType: string;
  readonly assistantText?: string;
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
  listOpenCodeModels(cwd: string): Promise<readonly PaseoModelDescriptor[]>;
  createOpenCodeAgent(input: {
    readonly cwd: string;
    readonly workspaceId: string;
    readonly model: string;
    readonly systemPrompt: string;
    readonly initialPrompt: string;
    readonly runId: string;
    readonly mcpServers?: readonly RuntimeMcpServerConfig[];
  }): Promise<PaseoCreatedAgent>;
  sendAgentMessage(agentId: string, text: string): Promise<void>;
  subscribeAgentStream?(
    listener: (event: PaseoAgentStreamEvent) => void,
  ): () => void;
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

  public async listOpenCodeModels(
    cwd: string,
  ): Promise<readonly PaseoModelDescriptor[]> {
    const result = await this.#client.listProviderModels('opencode', { cwd });
    if (result.error) {
      throw new Error(result.error);
    }
    return (result.models ?? []).map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.description ? { description: model.description } : {}),
    }));
  }

  public async createOpenCodeAgent(input: {
    readonly cwd: string;
    readonly workspaceId: string;
    readonly model: string;
    readonly systemPrompt: string;
    readonly initialPrompt: string;
    readonly runId: string;
    readonly mcpServers?: readonly RuntimeMcpServerConfig[];
  }): Promise<PaseoCreatedAgent> {
    const agent = await this.#client.createAgent({
      provider: 'opencode',
      model: input.model,
      modeId: 'build',
      cwd: input.cwd,
      workspaceId: input.workspaceId,
      systemPrompt: input.systemPrompt,
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
      },
    });
    return {
      id: agent.id,
      provider: agent.provider,
      model: agent.model ?? null,
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
      const event = message.payload.event;
      listener({
        agentId: message.payload.agentId,
        eventType: event.type,
        timestamp: message.payload.timestamp,
        seq: message.payload.seq ?? null,
        epoch: message.payload.epoch ?? null,
        timelineItemType: event.type === 'timeline' ? event.item.type : null,
        ...(event.type === 'timeline' && event.item.type === 'assistant_message'
          ? { assistantText: event.item.text }
          : {}),
      });
    });
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
      entries: page.entries.map((entry) => ({
        timelineItemType: entry.item.type,
        timestamp: entry.timestamp,
        seqStart: entry.seqStart,
        seqEnd: entry.seqEnd,
        ...(entry.item.type === 'assistant_message'
          ? { assistantText: entry.item.text }
          : {}),
      })),
    };
  }

  public async cancelAgent(agentId: string): Promise<void> {
    await this.#client.cancelAgent(agentId);
  }

  public close(): Promise<void> {
    return this.#client.close();
  }
}
