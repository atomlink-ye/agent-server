import {
  ExecutionPlaneUnavailableError,
  type AttachExecutionSessionOutcome,
  type CreatedExecutionSession,
  type ExecutionPlaneCapabilities,
  type ExecutionPlanePort,
  type ExecutionSessionBinding,
  type ExecutionSessionSpec,
} from '../../application/ports/execution-plane.js';

export class UnavailableExecutionPlane implements ExecutionPlanePort {
  public capabilities(): ExecutionPlaneCapabilities {
    return { supported: new Set() };
  }

  public async createSession(
    _spec: ExecutionSessionSpec,
  ): Promise<CreatedExecutionSession> {
    throw new ExecutionPlaneUnavailableError();
  }

  public async attachSession(
    _binding: ExecutionSessionBinding,
    _spec: ExecutionSessionSpec,
  ): Promise<AttachExecutionSessionOutcome> {
    throw new ExecutionPlaneUnavailableError();
  }

  public async health() {
    return {
      ready: false,
      plane: 'unavailable',
      checks: [
        {
          name: 'execution_plane',
          ready: false,
          detail: 'Runtime adapter is disabled.',
        },
      ],
    } as const;
  }

  public async close(): Promise<void> {}
}
