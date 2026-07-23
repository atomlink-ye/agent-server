import { mkdir } from 'node:fs/promises';

import {
  type AgentRuntimeExecution,
  type AgentRuntimeHealth,
  type AgentRuntimePort,
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from '../../application/ports/agent-runtime.js';
import type { Logger } from '../../shared/observability/logger.js';
import { PaseoConnectionError } from './errors.js';
import {
  selectOpenCodeModel,
  type PaseoModelDescriptor,
} from './model-selector.js';
import { PaseoSdkClient, type PaseoClientPort } from './paseo-client-port.js';
import { mapPaseoFinishStatus } from './status-mapper.js';

export interface PaseoRuntimeOptions {
  readonly wsUrl: string;
  readonly cwd: string;
  readonly workspaceTitle: string;
  readonly requestedModel?: string;
  readonly connectTimeoutMs: number;
  readonly executionTimeoutMs: number;
}

export class PaseoRuntimeAdapter implements AgentRuntimePort {
  readonly #client: PaseoClientPort;
  readonly #options: PaseoRuntimeOptions;
  readonly #logger: Logger;
  #initialization: Promise<void> | null = null;
  #workspaceId: string | null = null;
  #model: PaseoModelDescriptor | null = null;
  #lastError: string | null = null;

  public constructor(
    options: PaseoRuntimeOptions,
    logger: Logger,
    client: PaseoClientPort = new PaseoSdkClient({
      url: options.wsUrl,
      connectTimeoutMs: options.connectTimeoutMs,
    }),
  ) {
    this.#options = options;
    this.#logger = logger;
    this.#client = client;
  }

  public async initialize(): Promise<void> {
    const initialized = this.#workspaceId !== null && this.#model !== null;
    if (initialized && this.#client.connectionStatus() === 'connected') {
      return;
    }
    if (this.#initialization) {
      return this.#initialization;
    }

    this.#initialization = initialized
      ? this.#reconnectOnce()
      : this.#initializeOnce();
    try {
      await this.#initialization;
    } catch (error) {
      this.#initialization = null;
      this.#lastError = 'Runtime initialization failed.';
      throw error;
    } finally {
      this.#initialization = null;
    }
  }

  async #reconnectOnce(): Promise<void> {
    try {
      await this.#client.connect();
    } catch (error) {
      throw new PaseoConnectionError(
        error instanceof Error ? error.message : String(error),
      );
    }

    this.#lastError = null;
    this.#logger.log('info', 'runtime.reconnected', {
      provider: 'opencode',
      ...(this.#model ? { model: this.#model.id } : {}),
      ...(this.#workspaceId ? { workspace_id: this.#workspaceId } : {}),
    });
  }

  async #initializeOnce(): Promise<void> {
    await mkdir(this.#options.cwd, { recursive: true });
    try {
      await this.#client.connect();
    } catch (error) {
      throw new PaseoConnectionError(
        error instanceof Error ? error.message : String(error),
      );
    }

    const workspaceId = await this.#client.openWorkspace(this.#options.cwd);
    await this.#client.setWorkspaceTitle(
      workspaceId,
      this.#options.workspaceTitle,
    );
    const models = await this.#client.listOpenCodeModels(this.#options.cwd);
    const model = selectOpenCodeModel(models, this.#options.requestedModel);

    this.#workspaceId = workspaceId;
    this.#model = model;
    this.#lastError = null;
    this.#logger.log('info', 'runtime.initialized', {
      provider: 'opencode',
      model: model.id,
      workspace_id: workspaceId,
    });
  }

  public async execute(input: {
    readonly runId: string;
    readonly prompt: string;
  }): Promise<AgentRuntimeExecution> {
    await this.initialize();
    if (!this.#workspaceId || !this.#model) {
      throw new RuntimeExecutionError('Paseo runtime is not initialized.');
    }

    const agent = await this.#client.createOpenCodeAgent({
      cwd: this.#options.cwd,
      workspaceId: this.#workspaceId,
      model: this.#model.id,
      prompt: input.prompt,
      runId: input.runId,
    });
    const finished = await this.#client.waitForFinish(
      agent.id,
      this.#options.executionTimeoutMs,
    );
    const status = mapPaseoFinishStatus(finished.status);

    if (status === 'timed_out') {
      throw new RuntimeTimedOutError();
    }
    if (status === 'failed') {
      throw new RuntimeExecutionError(
        finished.error ?? `Paseo finished with status ${finished.status}`,
      );
    }
    if (finished.lastMessage === null) {
      throw new RuntimeExecutionError(
        'Paseo completed without a final assistant message.',
      );
    }

    return {
      provider: agent.provider || 'opencode',
      model: agent.model ?? this.#model.id,
      text: finished.lastMessage,
      ...(finished.usage ? { usage: finished.usage } : {}),
    };
  }

  public async health(): Promise<AgentRuntimeHealth> {
    const connected = this.#client.connectionStatus() === 'connected';
    const workspaceReady = this.#workspaceId !== null;
    const modelReady = this.#model !== null;
    const errorDetail = this.#lastError ?? undefined;

    return {
      ready: connected && workspaceReady && modelReady,
      provider: 'opencode',
      ...(this.#model ? { model: this.#model.id } : {}),
      checks: [
        {
          name: 'paseo_websocket',
          ready: connected,
          ...(!connected && errorDetail ? { detail: errorDetail } : {}),
        },
        {
          name: 'paseo_workspace',
          ready: workspaceReady,
          ...(!workspaceReady && errorDetail ? { detail: errorDetail } : {}),
        },
        {
          name: 'opencode_model',
          ready: modelReady,
          ...(!modelReady && errorDetail ? { detail: errorDetail } : {}),
        },
      ],
    };
  }

  public async close(): Promise<void> {
    this.#workspaceId = null;
    this.#model = null;
    this.#initialization = null;
    await this.#client.close();
  }
}
