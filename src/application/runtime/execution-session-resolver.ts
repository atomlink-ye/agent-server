import {
  ExecutionBindingUnavailableError,
  type ExecutionPlanePort,
  type ExecutionSession,
  type ExecutionSessionSpec,
  type ExecutionWorkspaceBinding,
} from '../ports/execution-plane.js';
import { requirePlaneCapability } from './execution-capabilities.js';
import type {
  RuntimeSession,
  RuntimeSessionRepository,
} from '../ports/runtime-session-repository.js';

export interface ResolvedExecutionSession {
  readonly runtimeSession: RuntimeSession;
  readonly session: ExecutionSession;
}

/**
 * Resolves one durable RuntimeSession to one process-local ExecutionSession.
 * External creation and durable binding happen here, before any turn prompt is sent.
 */
export class ExecutionSessionResolver {
  public constructor(
    private readonly plane: ExecutionPlanePort,
    private readonly runtimeSessions: Pick<
      RuntimeSessionRepository,
      'bindExecution'
    >,
  ) {}

  public async resolve(input: {
    readonly runtimeSession: RuntimeSession;
    readonly spec: Omit<
      ExecutionSessionSpec,
      'runtimeSessionId' | 'workspace'
    > & {
      readonly workspace: Omit<ExecutionSessionSpec['workspace'], 'binding'>;
    };
    readonly workspaceBinding?: ExecutionWorkspaceBinding | null;
  }): Promise<ResolvedExecutionSession> {
    const runtime = input.runtimeSession;
    const hasWorkspaceBinding = runtime.workspaceBinding !== null;
    const hasSessionBinding = runtime.sessionBinding !== null;
    if (hasWorkspaceBinding !== hasSessionBinding)
      throw new ExecutionBindingUnavailableError(
        'Runtime session execution binding is partial.',
      );

    const effectiveWorkspaceBinding =
      runtime.workspaceBinding ?? input.workspaceBinding ?? null;
    const spec: ExecutionSessionSpec = {
      ...input.spec,
      runtimeSessionId: runtime.id,
      workspace: {
        ...input.spec.workspace,
        ...(effectiveWorkspaceBinding
          ? { binding: effectiveWorkspaceBinding }
          : {}),
      },
    };

    if (runtime.sessionBinding) {
      requirePlaneCapability(this.plane.capabilities(), 'reusable_session');
      requirePlaneCapability(this.plane.capabilities(), 'external_workspace');
      if (!runtime.workspaceBinding)
        throw new ExecutionBindingUnavailableError(
          'Reusable execution session has no workspace binding.',
        );
      const session = await this.plane.attachSession(
        runtime.sessionBinding,
        spec,
      );
      return { runtimeSession: runtime, session };
    }

    if (effectiveWorkspaceBinding)
      requirePlaneCapability(this.plane.capabilities(), 'external_workspace');
    const created = await this.plane.createSession(spec);
    let bound: RuntimeSession;
    try {
      bound = await this.runtimeSessions.bindExecution({
        id: runtime.id,
        workspaceBinding: created.workspaceBinding,
        sessionBinding: created.sessionBinding,
      });
    } catch (error) {
      // close() is process-local and deliberately non-destructive. Most
      // importantly, run() has not been called, so no first prompt escaped.
      await created.session.close().catch(() => undefined);
      throw error;
    }
    return { runtimeSession: bound, session: created.session };
  }
}
