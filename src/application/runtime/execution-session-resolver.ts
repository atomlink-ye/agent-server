import { createHash } from 'node:crypto';

import {
  ExecutionBindingUnavailableError,
  type ExecutionExtensionBinding,
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
  readonly resolution: 'created' | 'reused' | 'reconfigured' | 'replaced';
}

/**
 * Resolves one stable RuntimeSession to a provider generation that satisfies the
 * current desired bootstrap spec. Returning from this method is the postcondition:
 * the active generation is usable with the current Agent Server extension plane.
 */
export class ExecutionSessionResolver {
  public constructor(
    private readonly plane: ExecutionPlanePort,
    private readonly runtimeSessions: Pick<
      RuntimeSessionRepository,
      | 'reconcileDesiredSpec'
      | 'bindExecution'
      | 'replaceExecution'
      | 'markUnavailable'
    >,
  ) {}

  public async resolve(input: {
    readonly runtimeSession: RuntimeSession;
    readonly spec: Omit<
      ExecutionSessionSpec,
      | 'runtimeSessionId'
      | 'workspace'
      | 'desiredRevision'
      | 'bootstrapSpecDigest'
      | 'endpointEpoch'
    > & {
      readonly workspace: Omit<ExecutionSessionSpec['workspace'], 'binding'>;
    };
    readonly workspaceBinding?: ExecutionWorkspaceBinding | null;
  }): Promise<ResolvedExecutionSession> {
    const initialRuntime = input.runtimeSession;
    const effectiveWorkspaceBinding =
      initialRuntime.currentGeneration?.workspaceBinding ??
      input.workspaceBinding ??
      null;
    const desiredDigest = executionBootstrapDigest({
      provider: input.spec.provider,
      model: input.spec.model,
      systemPrompt: input.spec.systemPrompt,
      cwd: input.spec.workspace.cwd,
      workspaceBinding: effectiveWorkspaceBinding,
      extensions: input.spec.extensions,
    });
    const runtime = await this.runtimeSessions.reconcileDesiredSpec({
      id: initialRuntime.id,
      digest: desiredDigest,
    });
    const endpointEpoch = input.spec.extensions?.endpointEpoch ?? 'none';
    const spec: ExecutionSessionSpec = {
      ...input.spec,
      runtimeSessionId: runtime.id,
      desiredRevision: runtime.desiredRevision,
      bootstrapSpecDigest: desiredDigest,
      endpointEpoch,
      workspace: {
        ...input.spec.workspace,
        ...(effectiveWorkspaceBinding
          ? { binding: effectiveWorkspaceBinding }
          : {}),
      },
    };

    const generation = runtime.currentGeneration;
    if (generation) {
      requirePlaneCapability(this.plane.capabilities(), 'reusable_session');
      requirePlaneCapability(this.plane.capabilities(), 'external_workspace');
      const outcome = await this.plane.attachSession(
        generation.sessionBinding,
        spec,
        {
          appliedRevision: generation.appliedRevision,
          appliedSpecDigest: generation.appliedSpecDigest,
          endpointEpoch: generation.endpointEpoch,
        },
      );
      if (outcome.kind === 'reused') {
        if (
          generation.appliedRevision !== runtime.desiredRevision ||
          generation.appliedSpecDigest !== desiredDigest ||
          generation.endpointEpoch !== endpointEpoch
        )
          throw new ExecutionBindingUnavailableError(
            'Execution plane reported reuse without applying the desired runtime spec.',
          );
        return {
          runtimeSession: runtime,
          session: outcome.session,
          resolution: 'reused',
        };
      }
      if (outcome.kind === 'reconfigured') {
        const replacedRecord = await this.runtimeSessions.replaceExecution({
          id: runtime.id,
          workspaceBinding: generation.workspaceBinding,
          sessionBinding: generation.sessionBinding,
          appliedRevision: runtime.desiredRevision,
          appliedSpecDigest: desiredDigest,
          endpointEpoch,
          ...(input.spec.extensions?.grantId
            ? { extensionGrantId: input.spec.extensions.grantId }
            : {}),
        });
        return {
          runtimeSession: replacedRecord,
          session: outcome.session,
          resolution: 'reconfigured',
        };
      }
      return this.replaceGeneration({
        runtime,
        spec,
        desiredDigest,
        endpointEpoch,
      });
    }

    if (effectiveWorkspaceBinding)
      requirePlaneCapability(this.plane.capabilities(), 'external_workspace');
    return this.createInitialGeneration({
      runtime,
      spec,
      desiredDigest,
      endpointEpoch,
    });
  }

  private async createInitialGeneration(input: {
    readonly runtime: RuntimeSession;
    readonly spec: ExecutionSessionSpec;
    readonly desiredDigest: string;
    readonly endpointEpoch: string;
  }): Promise<ResolvedExecutionSession> {
    const created = await this.plane.createSession(input.spec);
    let bound: RuntimeSession;
    try {
      bound = await this.runtimeSessions.bindExecution({
        id: input.runtime.id,
        workspaceBinding: created.workspaceBinding,
        sessionBinding: created.sessionBinding,
        appliedRevision: input.runtime.desiredRevision,
        appliedSpecDigest: input.desiredDigest,
        endpointEpoch: input.endpointEpoch,
        ...(input.spec.extensions?.grantId
          ? { extensionGrantId: input.spec.extensions.grantId }
          : {}),
      });
    } catch (error) {
      await created.session.close().catch(() => undefined);
      throw error;
    }
    return {
      runtimeSession: bound,
      session: created.session,
      resolution: 'created',
    };
  }

  private async replaceGeneration(input: {
    readonly runtime: RuntimeSession;
    readonly spec: ExecutionSessionSpec;
    readonly desiredDigest: string;
    readonly endpointEpoch: string;
  }): Promise<ResolvedExecutionSession> {
    let created: Awaited<ReturnType<ExecutionPlanePort['createSession']>>;
    try {
      created = await this.plane.createSession(input.spec);
    } catch (error) {
      await this.runtimeSessions.markUnavailable(input.runtime.id);
      throw error;
    }
    try {
      const replaced = await this.runtimeSessions.replaceExecution({
        id: input.runtime.id,
        workspaceBinding: created.workspaceBinding,
        sessionBinding: created.sessionBinding,
        appliedRevision: input.runtime.desiredRevision,
        appliedSpecDigest: input.desiredDigest,
        endpointEpoch: input.endpointEpoch,
        ...(input.spec.extensions?.grantId
          ? { extensionGrantId: input.spec.extensions.grantId }
          : {}),
      });
      return {
        runtimeSession: replaced,
        session: created.session,
        resolution: 'replaced',
      };
    } catch (error) {
      await created.session.close().catch(() => undefined);
      throw error;
    }
  }
}

function executionBootstrapDigest(input: {
  readonly provider?: string;
  readonly model?: string;
  readonly systemPrompt: string;
  readonly cwd: string;
  readonly workspaceBinding: ExecutionWorkspaceBinding | null;
  readonly extensions?: ExecutionExtensionBinding;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: input.provider ?? null,
        model: input.model ?? null,
        systemPromptSha256: createHash('sha256')
          .update(input.systemPrompt, 'utf8')
          .digest('hex'),
        cwd: input.cwd,
        workspace: input.workspaceBinding
          ? {
              plane: input.workspaceBinding.plane,
              externalWorkspaceId: input.workspaceBinding.externalWorkspaceId,
            }
          : null,
        extensions: input.extensions
          ? {
              digest: input.extensions.digest ?? null,
              endpointEpoch: input.extensions.endpointEpoch ?? null,
              grantId: input.extensions.grantId ?? null,
              servers: (input.extensions.mcpServers ?? []).map((server) => ({
                name: server.name,
                url: server.url,
              })),
            }
          : null,
      }),
    )
    .digest('hex');
}
