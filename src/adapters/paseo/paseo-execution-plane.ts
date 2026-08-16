import { mkdir } from 'node:fs/promises';

import {
  ExecutionBindingUnavailableError,
  ExecutionPlaneUnavailableError,
  ProtocolViolationError,
  type CreatedExecutionSession,
  type ExecutionPlaneCapabilities,
  type ExecutionPlaneHealth,
  type ExecutionPlanePort,
  type ExecutionSession,
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

  /** Idempotent eager connection hook used by process startup compatibility. */
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

    try {
      const created = await this.#gateway.createAgent({
        workspaceId: externalWorkspaceId,
        provider,
        model,
        systemPrompt: spec.systemPrompt,
        ...(spec.title ? { title: spec.title } : {}),
        ...(spec.labels ? { labels: spec.labels } : {}),
        ...(spec.extensions?.mcpServers
          ? { mcpServers: spec.extensions.mcpServers }
          : {}),
      });
      return {
        session: new PaseoExecutionSession(
          created.agentId,
          this.#runner,
          this.#logger,
        ),
        workspaceBinding,
        sessionBinding: {
          plane: PASEO_EXECUTION_PLANE_ID,
          externalSessionId: created.agentId,
        },
      };
    } catch (error) {
      if (error instanceof ProtocolViolationError) throw error;
      throw new ExecutionPlaneUnavailableError(
        error instanceof Error
          ? `Paseo session creation failed: ${error.name}`
          : 'Paseo session creation failed.',
      );
    }
  }

  public async attachSession(
    binding: ExecutionSessionBinding,
    _spec: ExecutionSessionSpec,
  ): Promise<ExecutionSession> {
    await this.initialize();
    this.#assertSessionBinding(binding);
    const exists = await this.#gateway.agentExists(binding.externalSessionId);
    if (!exists)
      throw new ExecutionBindingUnavailableError(
        'The Paseo Agent binding is no longer available.',
      );
    return new PaseoExecutionSession(
      binding.externalSessionId,
      this.#runner,
      this.#logger,
    );
  }

  public async health(): Promise<ExecutionPlaneHealth> {
    const health = await this.#connections.health();
    return {
      ready: health.ready,
      plane: PASEO_EXECUTION_PLANE_ID,
      provider: health.provider,
      model: health.model,
      checks: health.checks,
    };
  }

  public async close(): Promise<void> {
    await this.#connections.close();
  }

  #assertWorkspaceBinding(plane: string): void {
    if (plane !== PASEO_EXECUTION_PLANE_ID)
      throw new ExecutionBindingUnavailableError(
        'The execution workspace binding belongs to another plane.',
      );
  }

  #assertSessionBinding(binding: ExecutionSessionBinding): void {
    if (binding.plane !== PASEO_EXECUTION_PLANE_ID)
      throw new ExecutionBindingUnavailableError(
        'The execution session binding belongs to another plane.',
      );
  }

  #resolveLaunch(spec: ExecutionSessionSpec): {
    provider: ManagedEnvironmentProvider;
    model: string;
  } {
    const provider = spec.provider ?? this.#options.provider;
    if (!isManagedEnvironmentProvider(provider))
      throw new ProtocolViolationError('Unsupported Paseo provider.');
    const model = spec.model ?? this.#options.requestedModel;
    if (!model)
      throw new ProtocolViolationError('A Paseo model must be resolved before launch.');
    return { provider, model };
  }
}
