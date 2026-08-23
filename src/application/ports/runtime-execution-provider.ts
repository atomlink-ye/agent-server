import type {
  ExecutionExtensionBinding,
  ExecutionSession,
} from './execution-plane.js';
import type {
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../domain/runtime/runtime-session.js';
import type { RuntimeProviderCapabilities } from '../../domain/runtime/runtime-provider-capabilities.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type { RuntimeBootstrapDigestInput } from '../../domain/runtime/runtime-session-spec.js';

/** Provider-facing desired state, assembled from the current RuntimeSessionSpec. */
export interface ProviderRuntimeSpec {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;
  readonly systemPrompt: string;
  readonly workspaceId?: string | null;
  readonly workspaceTitle?: string;
  readonly title?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: ExecutionExtensionBinding;
  /** The RuntimeSessionSpec revision represented by this provider spec. */
  readonly revision?: RuntimeSpecRevision;
  readonly desiredRevision?: RuntimeSpecRevision;
  readonly bootstrapSpecDigest?: string;
  readonly endpointEpoch?: string;
}

export type ProviderAppliedRuntimeSpec = ProviderRuntimeSpec & {
  readonly revision: RuntimeSpecRevision;
};

/**
 * A short-lived provider binding. The generation owns durable provider identity;
 * applied is the historical spec revision that created that generation and
 * supplies the configuration needed to reopen its process-local handle.
 */
export interface ProviderSessionBinding {
  readonly generation: Pick<
    RuntimeSessionGeneration,
    | 'id'
    | 'runtimeSessionId'
    | 'provider'
    | 'providerWorkspaceId'
    | 'providerSessionId'
    | 'appliedSpecRevision'
  >;
  readonly applied: ProviderAppliedRuntimeSpec;
}

export interface ProviderSessionHandle {
  readonly provider: string;
  readonly model: string;
  readonly providerWorkspaceId: string | null;
  readonly providerSessionId: string;
  readonly session: ExecutionSession;
}

export interface ProviderObservedState {
  /** The provider session identity accepted by the timeline inspection call. */
  readonly providerSessionId: string;
  /**
   * The provider's report about all 11 components of the complete
   * RuntimeBootstrapDigestInput.
   * Indeterminate means the provider session is present, but the provider
   * cannot report these components; it is not the same fact as unavailable.
   */
  readonly bootstrapDigestComponents:
    | {
        readonly status: 'observed';
        readonly value: RuntimeBootstrapDigestInput;
      }
    | {
        readonly status: 'indeterminate';
        readonly reason: string;
      };
}

export type RuntimeProviderInspection =
  | {
      readonly status: 'available';
      readonly observed: ProviderObservedState;
    }
  | {
      readonly status: 'missing' | 'stale' | 'unavailable';
      readonly reason: string;
    };

/** Application port for provider session lifecycle and inspection. */
export interface RuntimeExecutionProvider {
  readonly name: string;

  capabilities(): RuntimeProviderCapabilities;

  create(desired: ProviderRuntimeSpec): Promise<ProviderSessionHandle>;

  inspect(binding: ProviderSessionBinding): Promise<RuntimeProviderInspection>;

  reconfigure(
    binding: ProviderSessionBinding,
    desired: ProviderRuntimeSpec,
  ): Promise<ProviderSessionHandle>;

  open(binding: ProviderSessionBinding): Promise<ExecutionSession>;

  close(binding: ProviderSessionBinding): Promise<void>;
}
