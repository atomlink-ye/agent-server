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
  RuntimeSessionGeneration,
  RuntimeSessionRepository,
} from '../ports/runtime-session-repository.js';
import type { Logger } from '../../shared/observability/logger.js';

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
    private readonly logger?: Logger,
  ) {}

  public async resolve(input: {
    readonly runtimeSession: RuntimeSession;
    readonly runId?: string;
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
    const bootstrap = {
      ...(input.spec.provider ? { provider: input.spec.provider } : {}),
      ...(input.spec.model ? { model: input.spec.model } : {}),
      systemPrompt: input.spec.systemPrompt,
      cwd: input.spec.workspace.cwd,
      workspaceBinding: effectiveWorkspaceBinding,
      ...(input.spec.extensions ? { extensions: input.spec.extensions } : {}),
    };
    const desiredDigest = executionBootstrapDigest(bootstrap);
    const components = executionBootstrapComponentFingerprints(bootstrap);
    const runtime = effectiveWorkspaceBinding
      ? await this.runtimeSessions.reconcileDesiredSpec({
          id: initialRuntime.id,
          digest: desiredDigest,
        })
      : initialRuntime;
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
        this.logResolution({
          runtime,
          runId: input.runId,
          generation,
          resolution: 'reused',
          reason: null,
          desiredDigest,
          components,
        });
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
        this.logResolution({
          runtime,
          runId: input.runId,
          generation,
          resolution: 'reconfigured',
          reason: 'plane_reconfigured',
          desiredDigest,
          components,
        });
        return {
          runtimeSession: replacedRecord,
          session: outcome.session,
          resolution: 'reconfigured',
        };
      }
      const replaced = await this.replaceGeneration({
        runtime,
        runId: input.runId,
        spec,
        endpointEpoch,
      });
      this.logResolution({
        runtime: replaced.resolved.runtimeSession,
        runId: input.runId,
        generation,
        resolution: 'replaced',
        reason: outcome.reason,
        desiredDigest: replaced.desiredDigest,
        components: replaced.components,
      });
      return replaced.resolved;
    }

    if (effectiveWorkspaceBinding)
      requirePlaneCapability(this.plane.capabilities(), 'external_workspace');
    const created = await this.createInitialGeneration({
      runtime,
      spec,
      endpointEpoch,
    });
    this.logResolution({
      runtime: created.resolved.runtimeSession,
      runId: input.runId,
      generation: null,
      resolution: 'created',
      reason: 'initial_generation',
      desiredDigest: created.desiredDigest,
      components: created.components,
    });
    return created.resolved;
  }

  private logResolution(input: {
    readonly runtime: RuntimeSession;
    readonly runId?: string | undefined;
    readonly generation: RuntimeSessionGeneration | null;
    readonly resolution: ResolvedExecutionSession['resolution'];
    readonly reason:
      | 'initial_generation'
      | 'plane_reconfigured'
      | 'extensions_changed'
      | 'bootstrap_digest_changed'
      | 'endpoint_epoch_changed'
      | 'provider_binding_stale'
      | 'provider_cannot_reconfigure'
      | null;
    readonly desiredDigest: string;
    readonly components: Readonly<Record<string, string | null>>;
  }): void {
    this.logger?.log('info', 'runtime.session.resolution', {
      runtime_session_id: input.runtime.id,
      run_id: input.runId ?? null,
      resolution: input.resolution,
      components: input.components,
      ...(input.resolution === 'reused'
        ? {}
        : {
            reason: input.reason,
            applied_spec_digest_prefix: prefix(
              input.generation?.appliedSpecDigest,
            ),
            applied_endpoint_epoch_prefix: prefix(
              input.generation?.endpointEpoch,
            ),
            applied_extension_grant_id_prefix: prefix(
              input.generation?.extensionGrantId ?? null,
            ),
            desired_spec_digest_prefix: prefix(input.desiredDigest),
          }),
    });
  }

  private async createInitialGeneration(input: {
    readonly runtime: RuntimeSession;
    readonly spec: ExecutionSessionSpec;
    readonly endpointEpoch: string;
  }): Promise<BootstrapResolution> {
    const created = await this.plane.createSession(input.spec);
    const actualBootstrap = executionBootstrapForSpec(
      input.spec,
      created.workspaceBinding,
    );
    const appliedSpecDigest = executionBootstrapDigest(actualBootstrap);
    const components = executionBootstrapComponentFingerprints(actualBootstrap);
    let bound: RuntimeSession;
    try {
      const runtime = await this.runtimeSessions.reconcileDesiredSpec({
        id: input.runtime.id,
        digest: appliedSpecDigest,
      });
      bound = await this.runtimeSessions.bindExecution({
        id: runtime.id,
        workspaceBinding: created.workspaceBinding,
        sessionBinding: created.sessionBinding,
        appliedRevision: runtime.desiredRevision,
        appliedSpecDigest,
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
      resolved: {
        runtimeSession: bound,
        session: created.session,
        resolution: 'created',
      },
      desiredDigest: appliedSpecDigest,
      components,
    };
  }

  private async replaceGeneration(input: {
    readonly runtime: RuntimeSession;
    readonly runId?: string | undefined;
    readonly spec: ExecutionSessionSpec;
    readonly endpointEpoch: string;
  }): Promise<BootstrapResolution> {
    let created: Awaited<ReturnType<ExecutionPlanePort['createSession']>>;
    try {
      created = await this.plane.createSession(input.spec);
    } catch (error) {
      await this.runtimeSessions.markUnavailable(input.runtime.id);
      throw error;
    }
    try {
      const actualBootstrap = executionBootstrapForSpec(
        input.spec,
        created.workspaceBinding,
      );
      const appliedSpecDigest = executionBootstrapDigest(actualBootstrap);
      const components =
        executionBootstrapComponentFingerprints(actualBootstrap);
      const replaceStartedAt = Date.now();
      try {
        const runtime = await this.runtimeSessions.reconcileDesiredSpec({
          id: input.runtime.id,
          digest: appliedSpecDigest,
        });
        const replaced = await this.runtimeSessions.replaceExecution({
          id: runtime.id,
          workspaceBinding: created.workspaceBinding,
          sessionBinding: created.sessionBinding,
          appliedRevision: runtime.desiredRevision,
          appliedSpecDigest,
          endpointEpoch: input.endpointEpoch,
          ...(input.spec.extensions?.grantId
            ? { extensionGrantId: input.spec.extensions.grantId }
            : {}),
        });
        return {
          resolved: {
            runtimeSession: replaced,
            session: created.session,
            resolution: 'replaced',
          },
          desiredDigest: appliedSpecDigest,
          components,
        };
      } finally {
        this.logger?.log(
          'info',
          'runtime.session.replace_execution.completed',
          {
            runtime_session_id: input.runtime.id,
            run_id: input.runId ?? null,
            duration_ms: Date.now() - replaceStartedAt,
          },
        );
      }
    } catch (error) {
      await created.session.close().catch(() => undefined);
      throw error;
    }
  }
}

interface ExecutionBootstrap {
  readonly provider?: string;
  readonly model?: string;
  readonly systemPrompt: string;
  readonly cwd: string;
  readonly workspaceBinding: ExecutionWorkspaceBinding | null;
  readonly extensions?: ExecutionExtensionBinding;
}

interface BootstrapResolution {
  readonly resolved: ResolvedExecutionSession;
  readonly desiredDigest: string;
  readonly components: Readonly<Record<string, string | null>>;
}

function executionBootstrapForSpec(
  spec: ExecutionSessionSpec,
  workspaceBinding: ExecutionWorkspaceBinding | null,
): ExecutionBootstrap {
  return {
    ...(spec.provider ? { provider: spec.provider } : {}),
    ...(spec.model ? { model: spec.model } : {}),
    systemPrompt: spec.systemPrompt,
    cwd: spec.workspace.cwd,
    workspaceBinding,
    ...(spec.extensions ? { extensions: spec.extensions } : {}),
  };
}

function executionBootstrapDigest(input: ExecutionBootstrap): string {
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

function executionBootstrapComponentFingerprints(
  input: ExecutionBootstrap,
): Readonly<Record<string, string | null>> {
  return Object.freeze({
    provider: fingerprint(input.provider ?? null),
    model: fingerprint(input.model ?? null),
    systemPromptSha256: fingerprint(input.systemPrompt),
    cwd: fingerprint(input.cwd),
    workspace: input.workspaceBinding
      ? fingerprint({
          plane: input.workspaceBinding.plane,
          externalWorkspaceId: input.workspaceBinding.externalWorkspaceId,
        })
      : null,
    extensions: input.extensions
      ? fingerprint({
          digest: input.extensions.digest ?? null,
          endpointEpoch: input.extensions.endpointEpoch ?? null,
          grantId: input.extensions.grantId ?? null,
          servers: (input.extensions.mcpServers ?? []).map((server) => ({
            name: server.name,
            url: server.url,
          })),
        })
      : null,
  });
}

function fingerprint(value: unknown): string | null {
  if (value === null) return null;
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
    .digest('hex')
    .slice(0, 12);
}

function prefix(value: string | null | undefined): string | null {
  return value ? `${value.slice(0, 12)}…` : null;
}
