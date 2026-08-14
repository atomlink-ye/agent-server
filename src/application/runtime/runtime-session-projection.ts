import type {
  ExecutionSessionBinding,
  ExecutionWorkspaceBinding,
} from '../ports/execution-plane.js';

export type RuntimeSessionBindingProjection = 'unbound' | 'bound' | 'partial';
export type RuntimeSessionActivityProjection = 'idle' | 'running';
export type RuntimeSessionAvailabilityProjection =
  | 'unknown'
  | 'available'
  | 'unavailable';

export interface RuntimeSessionProjection {
  readonly binding: RuntimeSessionBindingProjection;
  readonly activity: RuntimeSessionActivityProjection;
  readonly availability: RuntimeSessionAvailabilityProjection;
}

/**
 * Read-only projection. None of these values is durable RuntimeSession state:
 * Run remains the execution source of truth and Plane availability is observed.
 */
export function projectRuntimeSessionState(input: {
  readonly workspaceBinding: ExecutionWorkspaceBinding | null;
  readonly sessionBinding: ExecutionSessionBinding | null;
  readonly activeRunId: string | null;
  readonly observedAvailable?: boolean;
}): RuntimeSessionProjection {
  const binding =
    input.workspaceBinding && input.sessionBinding
      ? 'bound'
      : input.workspaceBinding || input.sessionBinding
        ? 'partial'
        : 'unbound';
  return {
    binding,
    activity: input.activeRunId ? 'running' : 'idle',
    availability:
      input.observedAvailable === undefined
        ? 'unknown'
        : input.observedAvailable
          ? 'available'
          : 'unavailable',
  };
}
