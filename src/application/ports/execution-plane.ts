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
