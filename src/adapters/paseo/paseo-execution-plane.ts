import { mkdir } from 'node:fs/promises';

import {
  ExecutionBindingUnavailableError,
  ExecutionPlaneUnavailableError,
  ProtocolViolationError,
  type AttachExecutionSessionOutcome,
  type CreatedExecutionSession,
  type ExecutionAppliedSessionSpec,
  type ExecutionPlaneCapabilities,
  type ExecutionPlaneHealth,
  type ExecutionPlanePort,
  type ExecutionSessionBinding,
  type ExecutionSessionSpec,
} from '../../application/ports/execution-plane.js';
import {
  isManagedEnvironmentProvider,
  type ManagedEnvironmentProvider,
} from '../../domain/environments/managed-environment-package.js';
import type { Logger } from '../../shared/observability/logger.js';
import { PaseoConnectionManager } from './paseo-connection-manager.js';
import type { PaseoClientPort } from './paseo-client-port.js';
import { PaseoExecutionSession } from './paseo-execution-session.js';
import { PaseoGateway } from './paseo-gateway.js';
import { PaseoSdkClient } from './paseo-sdk-client.js';
import { PaseoTurnRunner } from './paseo-turn-runner.js';

export const PASEO_EXECUTION_PLANE_ID = 'paseo';

const PASEO_PLANE_CAPABILITIES: ExecutionPlaneCapabilities = {
  supported: new Set([
    'streaming',
    'cancellation',
    'reusable_session',
    'external_workspace',
    'timeline_replay',
    'permissions',
    'nested_activities',
    'provider_discovery',
    'platform_mcp',
  ]),
};

export interface PaseoExecutionPlaneOptions {
  readonly wsUrl: string;
  readonly cwd: string;
  readonly provider: ManagedEnvironmentProvider;
  readonly workspaceTitle: string;
  readonly requestedModel?: string;
  readonly connectTimeoutMs: number;
  readonly executionTimeoutMs: number;
  readonly executionTimeoutSource?: 'env' | 'default';
}

/** First-class Agent Server Execution Plane backed by a Paseo daemon. */
export class PaseoExecutionPlane implements ExecutionPlanePort {
  readonly #options: PaseoExecutionPlaneOptions;
  readonly #logger: Logger;
  readonly #gateway: PaseoGateway;
  readonly #connections: PaseoConnectionManager;
  readonly #runner: PaseoTurnRunner;

  public constructor(
    options: PaseoExecutionPlaneOptions,
    logger: Logger,
    client: PaseoClientPort = new PaseoSdkClient({
      url: options.wsUrl,
      connectTimeoutMs: options.connectTimeoutMs,
    }),
  ) {
    this.#options = options;
    this.#logger = logger;
    this.#gateway = new PaseoGateway(client);
    this.#connections = new PaseoConnectionManager(
      client,
      {
        cwd: options.cwd,
        provider: options.provider,
        workspaceTitle: options.workspaceTitle,
        ...(options.requestedModel
          ? { requestedModel: options.requestedModel }
          : {}),
      },
      logger,
    );
    this.#runner = new PaseoTurnRunner(this.#gateway, logger, {
      executionTimeoutMs: options.executionTimeoutMs,
      ...(options.executionTimeoutSource
        ? { executionTimeoutSource: options.executionTimeoutSource }
        : {}),
      additionalProjectionRoots: [options.cwd],
    });
  }

  public capabilities(): ExecutionPlaneCapabilities {
    return PASEO_PLANE_CAPABILITIES;
  }

  /** Idempotent eager connection hook used by process startup. */
  public async initialize(): Promise<void> {
    try {
      await this.#connections.initialize();
    } catch (error) {
      if (error instanceof ExecutionPlaneUnavailableError) throw error;
      throw new ExecutionPlaneUnavailableError(
        error instanceof Error
          ? `Paseo initialization failed: ${error.name}`
          : 'Paseo initialization failed.',
      );
    }
  }

  public async createSession(
    spec: ExecutionSessionSpec,
  ): Promise<CreatedExecutionSession> {
    await this.initialize();
    const { provider, model } = this.#resolveLaunch(spec);
    const cwd = spec.workspace.cwd;
    await mkdir(cwd, { recursive: true });

    let externalWorkspaceId: string;
    if (spec.workspace.binding) {
      this.#assertWorkspaceBinding(spec.workspace.binding.plane);
      externalWorkspaceId = spec.workspace.binding.externalWorkspaceId;
    } else {
      const startedAt = Date.now();
      this.#logger.log('info', 'runtime.workspace.create.started', {
        runtime_session_id: spec.runtimeSessionId,
        model_id: model,
      });
      try {
        externalWorkspaceId = await this.#gateway.createWorkspace(cwd);
      } catch (error) {
        throw new ExecutionPlaneUnavailableError(
          error instanceof Error
            ? `Paseo workspace creation failed: ${error.name}`
            : 'Paseo workspace creation failed.',
        );
      }
      this.#logger.log('info', 'runtime.workspace.create.completed', {
        runtime_session_id: spec.runtimeSessionId,
        model_id: model,
        elapsed_ms: Date.now() - startedAt,
      });
      await this.#gateway.setWorkspaceTitle(
        externalWorkspaceId,
        spec.workspace.title ?? this.#options.workspaceTitle,
      );
    }

    const workspaceBinding = {
      plane: PASEO_EXECUTION_PLANE_ID,
      externalWorkspaceId,
    } as const;
    const agentStartedAt = Date.now();
    this.#logger.log('info', 'runtime.agent.create.started', {
      runtime_session_id: spec.runtimeSessionId,
      model_id: model,
    });
    let agent;
    try {
      agent = await this.#gateway.createAgent({
        provider,
        cwd,
        workspaceId: externalWorkspaceId,
        model,
        systemPrompt: spec.systemPrompt,
        runId: spec.runtimeSessionId,
        ...(spec.title ? { title: spec.title } : {}),
        ...(spec.labels ? { labels: spec.labels } : {}),
        ...(spec.extensions?.mcpServers
          ? { mcpServers: spec.extensions.mcpServers }
          : {}),
      });
    } catch (error) {
      throw new ExecutionPlaneUnavailableError(
        error instanceof Error
          ? `Paseo session creation failed: ${error.name}`
          : 'Paseo session creation failed.',
      );
    }
    if (!agent.id || !agent.provider || !agent.model)
      throw new ProtocolViolationError(
        'Paseo created a session without its required identity metadata.',
      );
    this.#logger.log('info', 'runtime.agent.create.completed', {
      runtime_session_id: spec.runtimeSessionId,
      model_id: agent.model,
      elapsed_ms: Date.now() - agentStartedAt,
    });

    const sessionBinding = {
      plane: PASEO_EXECUTION_PLANE_ID,
      externalSessionId: agent.id,
    } as const;
    return {
      workspaceBinding,
      sessionBinding,
      session: this.#session(
        sessionBinding,
        workspaceBinding,
        agent.provider,
        agent.model,
        cwd,
        Buffer.byteLength(spec.systemPrompt, 'utf8'),
      ),
    };
  }

  public async attachSession(
    binding: ExecutionSessionBinding,
    spec: ExecutionSessionSpec,
    applied?: ExecutionAppliedSessionSpec,
  ): Promise<AttachExecutionSessionOutcome> {
    await this.initialize();
    if (
      binding.plane !== PASEO_EXECUTION_PLANE_ID ||
      !binding.externalSessionId
    )
      throw new ExecutionBindingUnavailableError(
        'The runtime session is not bound to Paseo.',
      );
    if (!spec.workspace.binding)
      throw new ExecutionBindingUnavailableError(
        'A reusable Paseo session requires its workspace binding.',
      );
    this.#assertWorkspaceBinding(spec.workspace.binding.plane);

    if (
      applied &&
      spec.endpointEpoch &&
      applied.endpointEpoch !== spec.endpointEpoch
    ) {
      return { kind: 'replacement_required', reason: 'endpoint_epoch_changed' };
    }
    if (
      applied &&
      spec.bootstrapSpecDigest &&
      applied.appliedSpecDigest !== spec.bootstrapSpecDigest
    ) {
      return { kind: 'replacement_required', reason: 'extensions_changed' };
    }

    const { provider, model } = this.#resolveLaunch(spec);
    try {
      await this.#gateway.assertSessionAvailable(binding.externalSessionId);
    } catch {
      return {
        kind: 'replacement_required',
        reason: 'provider_binding_stale',
      };
    }
    return {
      kind: 'reused',
      appliedRevision: spec.desiredRevision ?? applied?.appliedRevision ?? 1,
      session: this.#session(
        binding,
        spec.workspace.binding,
        provider,
        model,
        spec.workspace.cwd,
        Buffer.byteLength(spec.systemPrompt, 'utf8'),
      ),
    };
  }

  public async health(): Promise<ExecutionPlaneHealth> {
    const health = this.#connections.health();
    return {
      ready: health.connected && health.workspaceReady && health.modelReady,
      plane: PASEO_EXECUTION_PLANE_ID,
      provider: this.#options.provider,
      ...(this.#connections.model ? { model: this.#connections.model.id } : {}),
      checks: [
        {
          name: 'paseo_websocket',
          ready: health.connected,
          ...(!health.connected && health.lastError
            ? { detail: health.lastError }
            : {}),
        },
        {
          name: 'paseo_workspace',
          ready: health.workspaceReady,
          ...(!health.workspaceReady && health.lastError
            ? { detail: health.lastError }
            : {}),
        },
        {
          name: 'opencode_model',
          ready: health.modelReady,
          ...(!health.modelReady && health.lastError
            ? { detail: health.lastError }
            : {}),
        },
      ],
    };
  }

  public close(): Promise<void> {
    return this.#connections.close();
  }

  #resolveLaunch(spec: ExecutionSessionSpec): {
    readonly provider: ManagedEnvironmentProvider;
    readonly model: string;
  } {
    const provider = spec.provider ?? this.#options.provider;
    if (!isManagedEnvironmentProvider(provider))
      throw new ProtocolViolationError(
        'The requested runtime provider is unsupported.',
      );
    const model = spec.model ?? this.#connections.model?.id;
    if (!model)
      throw new ExecutionPlaneUnavailableError(
        'Paseo has no resolved model for session launch.',
      );
    return { provider, model };
  }

  #assertWorkspaceBinding(plane: string): void {
    if (plane !== PASEO_EXECUTION_PLANE_ID)
      throw new ExecutionBindingUnavailableError(
        'The runtime workspace is not bound to Paseo.',
      );
  }

  #session(
    binding: ExecutionSessionBinding,
    workspaceBinding: {
      readonly plane: string;
      readonly externalWorkspaceId: string;
    },
    provider: string,
    model: string,
    cwd: string,
    systemPromptBytes: number,
  ): PaseoExecutionSession {
    return new PaseoExecutionSession(
      binding,
      workspaceBinding,
      { provider, model, cwd, systemPromptBytes },
      this.#gateway,
      this.#runner,
    );
  }
}
