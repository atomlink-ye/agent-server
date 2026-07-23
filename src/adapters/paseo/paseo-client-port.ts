import { DaemonClient } from '@getpaseo/client';

import type { RunUsage } from '../../domain/runs/run.js';
import type { PaseoFinishStatus } from './status-mapper.js';
import type { PaseoModelDescriptor } from './model-selector.js';

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

export interface PaseoClientPort {
  connect(): Promise<void>;
  connectionStatus(): string;
  openWorkspace(cwd: string): Promise<string>;
  setWorkspaceTitle(workspaceId: string, title: string): Promise<void>;
  listOpenCodeModels(cwd: string): Promise<readonly PaseoModelDescriptor[]>;
  createOpenCodeAgent(input: {
    readonly cwd: string;
    readonly workspaceId: string;
    readonly model: string;
    readonly prompt: string;
    readonly runId: string;
  }): Promise<PaseoCreatedAgent>;
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
    readonly prompt: string;
    readonly runId: string;
  }): Promise<PaseoCreatedAgent> {
    const agent = await this.#client.createAgent({
      provider: 'opencode',
      model: input.model,
      modeId: 'build',
      cwd: input.cwd,
      workspaceId: input.workspaceId,
      initialPrompt: input.prompt,
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

  public async cancelAgent(agentId: string): Promise<void> {
    await this.#client.cancelAgent(agentId);
  }

  public close(): Promise<void> {
    return this.#client.close();
  }
}
