import {
  ExecutionPlaneUnavailableError,
  type ExecutionPlaneHealth,
  type ExecutionSession,
} from '../../application/ports/execution-plane.js';
import type {
  ProviderRuntimeSpec,
  ProviderSessionBinding,
  ProviderSessionHandle,
  RuntimeExecutionProvider,
  RuntimeProviderInspection,
} from '../../application/ports/runtime-execution-provider.js';
import type { RuntimeProviderCapabilities } from '../../domain/runtime/runtime-provider-capabilities.js';

const UNAVAILABLE_CAPABILITIES: RuntimeProviderCapabilities = {
  canReconfigure: false,
  canCloseSession: false,
  canInspectBootstrapDigestComponents: false,
};

/** Explicit provider graph node for core mode when runtime execution is disabled. */
export class UnavailableRuntimeProvider implements RuntimeExecutionProvider {
  public readonly name = 'unavailable';

  public capabilities(): RuntimeProviderCapabilities {
    return UNAVAILABLE_CAPABILITIES;
  }

  public async ensureReady(): Promise<boolean> {
    return false;
  }

  public async health(): Promise<ExecutionPlaneHealth> {
    return {
      ready: false,
      plane: this.name,
      checks: [
        {
          name: 'execution_plane',
          ready: false,
          detail: 'Runtime adapter is disabled.',
        },
      ],
    };
  }

  public async create(
    _desired: ProviderRuntimeSpec,
  ): Promise<ProviderSessionHandle> {
    throw new ExecutionPlaneUnavailableError();
  }

  public async inspect(
    _binding: ProviderSessionBinding,
  ): Promise<RuntimeProviderInspection> {
    return {
      status: 'unavailable',
      reason: 'Runtime provider execution is disabled.',
    };
  }

  public async reconfigure(
    _binding: ProviderSessionBinding,
    _desired: ProviderRuntimeSpec,
  ): Promise<ProviderSessionHandle> {
    throw new ExecutionPlaneUnavailableError();
  }

  public async open(
    _binding: ProviderSessionBinding,
  ): Promise<ExecutionSession> {
    throw new ExecutionPlaneUnavailableError();
  }

  /** There is no external session in disabled mode, so this is a safe no-op. */
  public async closeSession(_binding: ProviderSessionBinding): Promise<void> {
    return Promise.resolve();
  }

  public async close(): Promise<void> {}
}
