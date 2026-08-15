import { mkdir } from 'node:fs/promises';

import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import type { Logger } from '../../shared/observability/logger.js';
import { PaseoConnectionError } from './errors.js';
import {
  selectOpenCodeModel,
  type PaseoModelDescriptor,
} from './model-selector.js';
import type { PaseoClientPort } from './paseo-client-port.js';

const STARTUP_CONNECT_ATTEMPTS = 3;
const STARTUP_CONNECT_BACKOFF_MS = [500, 1_000] as const;

export interface PaseoConnectionManagerOptions {
  readonly cwd: string;
  readonly provider: ManagedEnvironmentProvider;
  readonly workspaceTitle: string;
  readonly requestedModel?: string;
}

/** Owns the daemon connection lifetime. Per-session and per-turn state lives elsewhere. */
export class PaseoConnectionManager {
  readonly #client: PaseoClientPort;
  readonly #options: PaseoConnectionManagerOptions;
  readonly #logger: Logger;
  #initialization: Promise<void> | null = null;
  #defaultWorkspaceId: string | null = null;
  #defaultModel: PaseoModelDescriptor | null = null;
  #lastError: string | null = null;
  #generation = 0;
  #connectedGeneration: number | null = null;

  public constructor(
    client: PaseoClientPort,
    options: PaseoConnectionManagerOptions,
    logger: Logger,
  ) {
    this.#client = client;
    this.#options = options;
    this.#logger = logger;
  }

  public get model(): PaseoModelDescriptor | null {
    return this.#defaultModel;
  }

  public get defaultWorkspaceId(): string | null {
    return this.#defaultWorkspaceId;
  }

  public get lastError(): string | null {
    return this.#lastError;
  }

  public connectionStatus(): string {
    return this.#client.connectionStatus();
  }

  public async initialize(): Promise<void> {
    const initialized = this.#defaultModel !== null;
    if (initialized && this.#client.connectionStatus() === 'connected') return;
    if (this.#initialization) return this.#initialization;

    const generation = ++this.#generation;
    const attempt = initialized
      ? this.#reconnectOnce(generation)
      : this.#initializeOnce(generation);
    this.#initialization = attempt;
    try {
      await attempt;
    } catch (error) {
      if (this.#initialization === attempt)
        this.#lastError = 'Runtime initialization failed.';
      throw error;
    } finally {
      if (this.#initialization === attempt) this.#initialization = null;
    }
  }

  async #reconnectOnce(generation: number): Promise<void> {
    await this.#connectWithStartupRetry();
    if (await this.#discardStaleConnection(generation)) return;
    this.#lastError = null;
    this.#logger.log('info', 'runtime.reconnected', {
      provider: this.#options.provider,
      ...(this.#defaultModel ? { model: this.#defaultModel.id } : {}),
      ...(this.#defaultWorkspaceId
        ? { workspace_id: this.#defaultWorkspaceId }
        : {}),
    });
  }

  async #initializeOnce(generation: number): Promise<void> {
    await mkdir(this.#options.cwd, { recursive: true });
    await this.#connectWithStartupRetry();
    if (await this.#discardStaleConnection(generation)) return;

    const models = await this.#client.listModels(
      this.#options.provider,
      this.#options.cwd,
    );
    const model = selectOpenCodeModel(models, this.#options.requestedModel);
    const workspaceId = await this.#client.openWorkspace(this.#options.cwd);
    await this.#client.setWorkspaceTitle(
      workspaceId,
      this.#options.workspaceTitle,
    );

    if (this.#generation !== generation) return;
    this.#defaultModel = model;
    this.#defaultWorkspaceId = workspaceId;
    this.#lastError = null;
    this.#logger.log('info', 'runtime.initialized', {
      provider: this.#options.provider,
      model: model.id,
    });
  }

  async #connectWithStartupRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < STARTUP_CONNECT_ATTEMPTS; attempt += 1) {
      try {
        await this.#client.connect();
        return;
      } catch (error) {
        lastError = error;
        const delayMs = STARTUP_CONNECT_BACKOFF_MS[attempt];
        if (delayMs !== undefined)
          await new Promise<void>((resolveDelay) => {
            setTimeout(resolveDelay, delayMs);
          });
      }
    }
    throw new PaseoConnectionError(
      lastError instanceof Error ? lastError.message : String(lastError),
    );
  }

  async #discardStaleConnection(generation: number): Promise<boolean> {
    if (this.#generation === generation) {
      this.#connectedGeneration = generation;
      return false;
    }
    if (this.#initialization === null && this.#connectedGeneration === null)
      await this.#client.close();
    return true;
  }

  public health(): {
    readonly connected: boolean;
    readonly workspaceReady: boolean;
    readonly modelReady: boolean;
    readonly lastError?: string;
  } {
    return {
      connected: this.#client.connectionStatus() === 'connected',
      workspaceReady: this.#defaultWorkspaceId !== null,
      modelReady: this.#defaultModel !== null,
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
    };
  }

  public async close(): Promise<void> {
    this.#generation += 1;
    this.#connectedGeneration = null;
    this.#defaultWorkspaceId = null;
    this.#defaultModel = null;
    this.#initialization = null;
    await this.#client.close();
  }
}
