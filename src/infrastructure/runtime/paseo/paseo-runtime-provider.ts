import { mkdir } from 'node:fs/promises';

import {
  ExecutionBindingUnavailableError,
  ExecutionPlaneUnavailableError,
  ProtocolViolationError,
  UnsupportedCapabilityError,
  type ExecutionSession,
} from '../../../application/ports/execution-plane.js';
import type {
  ProviderRuntimeSpec,
  ProviderSessionBinding,
  ProviderSessionHandle,
  RuntimeExecutionProvider,
  RuntimeProviderInspection,
  ProviderObservedState,
} from '../../../application/ports/runtime-execution-provider.js';
import type { RuntimeProviderCapabilities } from '../../../domain/runtime/runtime-provider-capabilities.js';
import {
  isManagedEnvironmentProvider,
  type ManagedEnvironmentProvider,
} from '../../../domain/environments/managed-environment-package.js';
import type { Logger } from '../../../shared/observability/logger.js';
import type { AppConfig } from '../../../shared/config.js';
import { PaseoConnectionManager } from '../../../adapters/paseo/paseo-connection-manager.js';
import type { PaseoClientPort } from '../../../adapters/paseo/paseo-client-port.js';
import { PaseoExecutionSession } from '../../../adapters/paseo/paseo-execution-session.js';
import { PaseoGateway } from '../../../adapters/paseo/paseo-gateway.js';
import { PaseoSdkClient } from '../../../adapters/paseo/paseo-sdk-client.js';
import { PaseoTurnRunner } from '../../../adapters/paseo/paseo-turn-runner.js';
import { normalizePaseoRequestedModel } from './paseo-model-normalizer.js';
import { mapPaseoConfig } from './paseo-config-mapper.js';

const PASEO_RUNTIME_PROVIDER_CAPABILITIES: RuntimeProviderCapabilities = {
  canReconfigure: false,
  canCloseSession: false,
};

const MISSING_SESSION_ERROR_CODES = new Set([
  'agent_not_found',
  'missing_session',
  'provider_agent_not_found',
  'provider_not_found',
  'provider_session_missing',
  'provider_session_not_found',
  'session_missing',
  'session_not_found',
]);

type ProviderBindingInspectionFailure = {
  readonly status: 'missing' | 'stale';
  readonly reason: string;
};

type ProviderUnavailableInspection = {
  readonly status: 'unavailable';
  readonly reason: string;
};

export interface PaseoRuntimeProviderOptions {
  readonly wsUrl: string;
  readonly cwd: string;
  readonly provider: ManagedEnvironmentProvider;
  readonly workspaceTitle: string;
  readonly requestedModel?: string;
  readonly connectTimeoutMs: number;
  readonly executionTimeoutMs: number;
  readonly executionTimeoutSource?: 'env' | 'default';
}

export function createPaseoRuntimeProvider(
  config: Pick<AppConfig, 'paseo'>,
  logger: Logger,
  client?: PaseoClientPort,
): PaseoRuntimeProvider {
  const options = mapPaseoConfig(config);
  return client
    ? new PaseoRuntimeProvider(options, logger, client)
    : new PaseoRuntimeProvider(options, logger);
}

/** RuntimeExecutionProvider implementation backed directly by Paseo's gateway. */
export class PaseoRuntimeProvider implements RuntimeExecutionProvider {
  public readonly name = 'paseo';
  readonly #options: PaseoRuntimeProviderOptions;
  readonly #gateway: PaseoGateway;
  readonly #connections: PaseoConnectionManager;
  readonly #runner: PaseoTurnRunner;
  readonly #logger: Logger;

  public constructor(
    options: PaseoRuntimeProviderOptions,
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
          ? {
              requestedModel: normalizePaseoRequestedModel(
                options.provider,
                options.requestedModel,
              ),
            }
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

  public capabilities(): RuntimeProviderCapabilities {
    return PASEO_RUNTIME_PROVIDER_CAPABILITIES;
  }

  public async create(
    desired: ProviderRuntimeSpec,
  ): Promise<ProviderSessionHandle> {
    await this.#initialize();
    const { provider, model } = this.#resolveLaunch(desired);
    await mkdir(desired.cwd, { recursive: true });

    let workspaceId: string;
    try {
      workspaceId = await this.#gateway.createWorkspace(desired.cwd);
      await this.#gateway.setWorkspaceTitle(
        workspaceId,
        desired.workspaceTitle ?? this.#options.workspaceTitle,
      );
    } catch (error) {
      throw new ExecutionPlaneUnavailableError(
        error instanceof Error
          ? `Paseo workspace creation failed: ${error.name}`
          : 'Paseo workspace creation failed.',
      );
    }

    let agent;
    try {
      agent = await this.#gateway.createAgent({
        provider,
        cwd: desired.cwd,
        workspaceId,
        model,
        systemPrompt: desired.systemPrompt,
        runId: desired.runtimeSessionId,
        ...(desired.title ? { title: desired.title } : {}),
        ...(desired.labels ? { labels: desired.labels } : {}),
        ...(desired.extensions?.mcpServers
          ? { mcpServers: desired.extensions.mcpServers }
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

    const session = this.#session({
      provider: agent.provider,
      providerWorkspaceId: workspaceId,
      providerSessionId: agent.id,
      spec: desired,
      model: agent.model,
    });
    return {
      provider: agent.provider,
      model: agent.model,
      providerWorkspaceId: workspaceId,
      providerSessionId: agent.id,
      session,
    };
  }

  public async inspect(
    binding: ProviderSessionBinding,
  ): Promise<RuntimeProviderInspection> {
    const structuralFailure = this.#validateBinding(binding);
    if (structuralFailure) return structuralFailure;

    try {
      await this.#initialize();
      const timeline = this.#gateway.fetchTimeline(
        binding.generation.providerSessionId!,
      );
      if (!timeline)
        return this.#inspectionUnavailable(
          'Paseo session timeline inspection is unavailable.',
        );
      await timeline;
    } catch (error) {
      // Missing timeline capability, transport errors, and protocol projection
      // errors are all uncertainty about availability, never proof of staleness.
      const code = structuredErrorCode(error);
      if (code && MISSING_SESSION_ERROR_CODES.has(code))
        return {
          status: 'missing',
          reason: 'Paseo reported that the provider session is missing.',
        };
      return this.#inspectionUnavailable(
        'Paseo session inspection failed.',
        error,
      );
    }

    const observed: ProviderObservedState = {
      providerSessionId: binding.generation.providerSessionId!,
      bootstrapDigestComponents: null,
    };
    return { status: 'available', observed };
  }

  public async reconfigure(
    _binding: ProviderSessionBinding,
    _desired: ProviderRuntimeSpec,
  ): Promise<ProviderSessionHandle> {
    throw new UnsupportedCapabilityError(
      'Paseo cannot reconfigure an existing provider session.',
    );
  }

  public async open(
    binding: ProviderSessionBinding,
  ): Promise<ExecutionSession> {
    const structuralFailure = this.#validateBinding(binding);
    if (structuralFailure) throw this.#bindingError(structuralFailure);
    await this.#initialize();
    const { provider, model } = this.#resolveLaunch(binding.applied);
    return this.#session({
      provider,
      providerWorkspaceId: binding.generation.providerWorkspaceId!,
      providerSessionId: binding.generation.providerSessionId!,
      spec: binding.applied,
      model,
    });
  }

  /** Paseo has no per-agent close/archive operation. */
  public async close(_binding: ProviderSessionBinding): Promise<void> {
    throw new UnsupportedCapabilityError(
      'Paseo cannot close an individual provider session.',
    );
  }

  async #initialize(): Promise<void> {
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

  #resolveLaunch(desired: ProviderRuntimeSpec): {
    readonly provider: ManagedEnvironmentProvider;
    readonly model: string;
  } {
    if (
      !isManagedEnvironmentProvider(desired.provider) ||
      desired.provider !== this.#options.provider
    )
      throw new ProtocolViolationError(
        'The requested runtime provider is unsupported by Paseo.',
      );
    const model = desired.model
      ? normalizePaseoRequestedModel(desired.provider, desired.model)
      : this.#connections.model?.id;
    if (!model)
      throw new ExecutionPlaneUnavailableError(
        'Paseo has no resolved model for session launch.',
      );
    return { provider: desired.provider, model };
  }

  #session(input: {
    readonly provider: string;
    readonly providerWorkspaceId: string;
    readonly providerSessionId: string;
    readonly spec: ProviderRuntimeSpec;
    readonly model?: string;
  }): PaseoExecutionSession {
    const model = input.model ?? this.#resolveLaunch(input.spec).model;
    return new PaseoExecutionSession(
      {
        plane: this.name,
        externalSessionId: input.providerSessionId,
      },
      {
        plane: this.name,
        externalWorkspaceId: input.providerWorkspaceId,
      },
      {
        provider: input.provider,
        model,
        cwd: input.spec.cwd,
        systemPromptBytes: Buffer.byteLength(input.spec.systemPrompt, 'utf8'),
      },
      this.#gateway,
      this.#runner,
    );
  }

  #validateBinding(
    binding: ProviderSessionBinding,
  ): ProviderBindingInspectionFailure | null {
    if (!binding.generation.providerSessionId)
      return {
        status: 'stale',
        reason:
          'The persisted provider session binding has no provider session id.',
      };
    if (
      binding.generation.provider !== this.#options.provider ||
      binding.applied.provider !== binding.generation.provider ||
      binding.generation.runtimeSessionId !==
        binding.applied.runtimeSessionId ||
      binding.applied.revision !== binding.generation.appliedSpecRevision
    )
      return {
        status: 'stale',
        reason:
          'The provider session binding belongs to a different provider or runtime session.',
      };
    if (!binding.generation.providerWorkspaceId)
      return {
        status: 'stale',
        reason: 'The provider session binding has no provider workspace id.',
      };
    return null;
  }

  #bindingError(failure: ProviderBindingInspectionFailure): Error {
    return new ExecutionBindingUnavailableError(failure.reason);
  }

  #inspectionUnavailable(
    reason: string,
    error?: unknown,
  ): ProviderUnavailableInspection {
    const code = structuredErrorCode(error);
    this.#logger.log('warn', 'runtime.provider.inspect.unavailable', {
      provider: this.name,
      operation: 'inspect',
      reason,
      error_type: error instanceof Error ? error.name : 'unknown',
      ...(code ? { error_code: code } : {}),
    });
    return { status: 'unavailable', reason };
  }
}

function structuredErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}
