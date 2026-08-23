import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import type { ExecutionExtensionBinding } from './runtime-extension-binding.js';
import type { ExecutionSession } from './runtime-execution-session.js';
export {
  ProtocolViolationError,
  UnsupportedCapabilityError,
  supportsSessionCapability,
} from './runtime-execution-session.js';
export type {
  ExecutionFailure,
  ExecutionObservation,
  ExecutionObservationSink,
  ExecutionOutput,
  ExecutionResult,
  ExecutionRunInput,
  ExecutionSession,
  ExecutionSessionCapabilities,
  ExecutionSessionCapability,
  ExecutionToolCategory,
  ExecutionToolDetail,
  ExecutionToolStatus,
} from './runtime-execution-session.js';

export type ExecutionPlaneCapability =
  | 'streaming'
  | 'cancellation'
  | 'reusable_session'
  | 'external_workspace'
  | 'timeline_replay'
  | 'permissions'
  | 'nested_activities'
  | 'provider_discovery'
  | 'platform_mcp';

export interface ExecutionPlaneCapabilities {
  readonly supported: ReadonlySet<ExecutionPlaneCapability>;
}

export interface ExecutionPlaneHealthCheck {
  readonly name: string;
  readonly ready: boolean;
  readonly detail?: string;
}

export interface ExecutionPlaneHealth {
  readonly ready: boolean;
  readonly plane: string;
  readonly provider?: string;
  readonly model?: string;
  readonly checks: readonly ExecutionPlaneHealthCheck[];
}

export interface ExecutionWorkspaceBinding {
  readonly plane: string;
  readonly externalWorkspaceId: string;
}

export interface ExecutionSessionBinding {
  readonly plane: string;
  readonly externalSessionId: string;
}

export interface ExecutionWorkspaceSpec {
  readonly cwd: string;
  readonly binding?: ExecutionWorkspaceBinding;
  readonly title?: string;
}

export interface ExecutionSessionSpec {
  /** Agent Server durable identity. It must exist before createSession is called. */
  readonly runtimeSessionId: string;
  readonly workspace: ExecutionWorkspaceSpec;
  readonly provider?: string;
  readonly model?: string;
  readonly systemPrompt: string;
  readonly title?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: ExecutionExtensionBinding;
  /** Monotonic desired bootstrap revision owned by Agent Server. */
  readonly desiredRevision?: number;
  /** Stable digest of provider/model/workspace/extension bootstrap state. */
  readonly bootstrapSpecDigest?: string;
  /** Provider-visible Agent Server endpoint epoch used by this spec. */
  readonly endpointEpoch?: string;
  /** Machine-readable product/runtime identity; never recover this from prompt text. */
  readonly invocationContext?: RuntimeInvocationContext;
}

export interface ExecutionAppliedSessionSpec {
  readonly appliedRevision: number;
  readonly appliedSpecDigest: string | null;
  readonly endpointEpoch: string;
}

export interface CreatedExecutionSession {
  readonly session: ExecutionSession;
  readonly workspaceBinding: ExecutionWorkspaceBinding;
  readonly sessionBinding: ExecutionSessionBinding;
}

export type AttachExecutionSessionOutcome =
  | {
      readonly kind: 'reused';
      readonly session: ExecutionSession;
      readonly appliedRevision: number;
    }
  | {
      readonly kind: 'reconfigured';
      readonly session: ExecutionSession;
      readonly appliedRevision: number;
    }
  | {
      readonly kind: 'replacement_required';
      readonly reason:
        | 'extensions_changed'
        | 'bootstrap_digest_changed'
        | 'endpoint_epoch_changed'
        | 'provider_binding_stale'
        | 'provider_cannot_reconfigure';
    };

export interface ExecutionPlanePort {
  capabilities(): ExecutionPlaneCapabilities;
  createSession(spec: ExecutionSessionSpec): Promise<CreatedExecutionSession>;
  attachSession(
    binding: ExecutionSessionBinding,
    spec: ExecutionSessionSpec,
    applied?: ExecutionAppliedSessionSpec,
  ): Promise<AttachExecutionSessionOutcome>;
  health(): Promise<ExecutionPlaneHealth>;
  close(): Promise<void>;
}

export class ExecutionPlaneUnavailableError extends Error {
  public constructor(message = 'The execution plane is unavailable.') {
    super(message);
    this.name = 'ExecutionPlaneUnavailableError';
  }
}

export class ExecutionBindingUnavailableError extends Error {
  public constructor(message = 'The execution binding is unavailable.') {
    super(message);
    this.name = 'ExecutionBindingUnavailableError';
  }
}

export function supportsPlaneCapability(
  capabilities: ExecutionPlaneCapabilities,
  capability: ExecutionPlaneCapability,
): boolean {
  return capabilities.supported.has(capability);
}
