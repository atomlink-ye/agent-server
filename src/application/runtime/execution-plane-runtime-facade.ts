import {
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from './execution-runtime-errors.js';
import type { RunUsage } from '../../domain/runs/run.js';
import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import type { ResourceOwner } from '../../domain/tenancy/product-context.js';
import type {
  ExecutionExtensionBinding,
  ExecutionObservationSink,
  ExecutionPlaneHealth,
  ExecutionPlanePort,
  ExecutionSession,
  ExecutionSessionBinding,
  ExecutionWorkspaceBinding,
} from '../ports/execution-plane.js';
import type {
  RuntimeMemoryCandidate,
  RuntimeMemoryCandidateCollector,
} from '../ports/runtime-memory-candidate-collector.js';
import type {
  RuntimeSession,
  RuntimeSessionLookup,
  RuntimeSessionRepository,
} from '../ports/runtime-session-repository.js';
import type { RuntimeWorkspaceRepository } from '../ports/runtime-workspace-repository.js';
import type { Logger } from '../../shared/observability/logger.js';
import { ExecutionRunRegistry } from './execution-run-registry.js';
import { ExecutionSessionResolver } from './execution-session-resolver.js';

export type ExecutionWorkspaceOwner =
  | {
      readonly kind: 'product_session';
      readonly id: string;
      readonly tenantId: string;
      readonly productWorkspaceId: string;
      readonly principalType: string;
      readonly principalId: string;
    }
  | {
      readonly kind: 'team_run';
      readonly id: string;
      readonly tenantId: string;
      readonly productWorkspaceId: string;
      readonly principalType: string;
      readonly principalId: string;
    };

export interface ExecutionTurnRequest {
  readonly runId: string;
  readonly prompt: string;
  /** Canonical snapshot prompt used when resolution replaces an unavailable durable provider session. */
  readonly recoveryPrompt?: string;
  readonly runtimeSessionId?: string;
  readonly cwd?: string;
  readonly workspaceBinding?: ExecutionWorkspaceBinding;
  readonly workspaceOwner?: ExecutionWorkspaceOwner;
  readonly requireExistingWorkspaceBinding?: boolean;
  readonly compatibilitySessionBinding?: ExecutionSessionBinding;
  readonly workspaceTitle?: string;
  readonly sessionTitle?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly provider?: string;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly extensions?: ExecutionExtensionBinding;
  readonly invocationContext?: RuntimeInvocationContext;
  readonly proposalLimit?: number;
}

export interface ExecutionTurnOutcome {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly workspaceBinding: ExecutionWorkspaceBinding;
  readonly sessionBinding: ExecutionSessionBinding;
  readonly sessionResolution?:
    'created' | 'reused' | 'reconfigured' | 'replaced';
  readonly usedRecoveryPrompt?: boolean;
  readonly usage?: RunUsage;
  readonly memoryCandidates?: readonly RuntimeMemoryCandidate[];
}

export interface ExecutionRuntimeService {
  ensureReady(): Promise<boolean>;
  ensureAgentChatRuntimeSession(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly agentOwner: ResourceOwner;
    readonly agentVersionId: string;
    readonly resolvedSkills: readonly {
      readonly ref: string;
      readonly digest: string;
    }[];
    readonly toolRefs: readonly string[];
  }): Promise<RuntimeSession>;
  executeTurn(
    input: ExecutionTurnRequest,
    observer?: ExecutionObservationSink,
  ): Promise<ExecutionTurnOutcome>;
  cancelRun(input: {
    readonly runId: string;
    readonly compatibilitySessionBinding?: ExecutionSessionBinding;
  }): Promise<void>;
  planeHealth(): Promise<ExecutionPlaneHealth>;
  close(): Promise<void>;
}

interface CachedFreshSession {
  readonly session: ExecutionSession;
  readonly sessionBinding: ExecutionSessionBinding;
  readonly workspaceBinding: ExecutionWorkspaceBinding;
}

export class ExecutionPlaneRuntimeFacade implements ExecutionRuntimeService {
  readonly #resolver: ExecutionSessionResolver;
  readonly #freshSessions = new Map<string, CachedFreshSession>();

  public constructor(
    private readonly plane: ExecutionPlanePort,
    private readonly runtimeSessions: RuntimeSessionRepository,
    private readonly runtimeSessionLookup: RuntimeSessionLookup,
    private readonly runtimeWorkspaces: RuntimeWorkspaceRepository,
    private readonly runRegistry: ExecutionRunRegistry,
    private readonly memoryCandidates: RuntimeMemoryCandidateCollector,
    private readonly defaultCwd: string,
    private readonly logger?: Logger,
  ) {
    this.#resolver = new ExecutionSessionResolver(
      plane,
      runtimeSessions,
      logger,
    );
  }

  public async ensureReady(): Promise<boolean> {
    try {
      await this.initialize();
      return (await this.plane.health()).ready;
    } catch {
      return false;
    }
  }

  public ensureAgentChatRuntimeSession(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly agentOwner: ResourceOwner;
    readonly agentVersionId: string;
    readonly resolvedSkills: readonly {
      readonly ref: string;
      readonly digest: string;
    }[];
    readonly toolRefs: readonly string[];
  }): Promise<RuntimeSession> {
    return this.runtimeSessions.createOrGetForAgentChat({
      agentChatRuntimeId: input.agentChatRuntimeId,
      runtimeEpoch: input.runtimeEpoch,
      tenantId: input.agentOwner.scope.tenantId,
      workspaceId: input.agentOwner.scope.workspaceId,
      principalType: input.agentOwner.principal.type,
      principalId: input.agentOwner.principal.id,
      agentVersionId: input.agentVersionId,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
    });
  }

  public async executeTurn(
    input: ExecutionTurnRequest,
    observer?: ExecutionObservationSink,
  ): Promise<ExecutionTurnOutcome> {
    const cwd = input.cwd ?? this.defaultCwd;
    const ownerWorkspaceBinding = await this.#resolveWorkspaceBinding(input);
    if (input.requireExistingWorkspaceBinding && !ownerWorkspaceBinding)
      throw new RuntimeExecutionError(
        'The owning runtime workspace has no execution-plane binding.',
      );
    const candidateSession = await this.memoryCandidates.prepare({
      runId: input.runId,
      cwd,
      proposalLimit: input.proposalLimit ?? 0,
    });
    const normalPrompt = candidateSession.decoratePrompt(input.prompt);
    const recoveryPrompt = input.recoveryPrompt
      ? candidateSession.decoratePrompt(input.recoveryPrompt)
      : undefined;

    let executionSession: ExecutionSession;
    let workspaceBinding: ExecutionWorkspaceBinding;
    let sessionBinding: ExecutionSessionBinding;
    let sessionResolution: ExecutionTurnOutcome['sessionResolution'];
    let closeAfterTurn = false;

    if (input.runtimeSessionId) {
      const runtimeSession = await this.runtimeSessionLookup.findById(
        input.runtimeSessionId,
      );
      if (!runtimeSession)
        throw new RuntimeExecutionError(
          `Runtime session ${input.runtimeSessionId} could not be loaded.`,
        );
      const resolved = await this.#resolver.resolve({
        runtimeSession,
        runId: input.runId,
        spec: {
          workspace: {
            cwd,
            ...(input.workspaceTitle ? { title: input.workspaceTitle } : {}),
          },
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.model ? { model: input.model } : {}),
          systemPrompt: input.systemPrompt ?? '',
          ...(input.sessionTitle ? { title: input.sessionTitle } : {}),
          ...(input.labels ? { labels: input.labels } : {}),
          ...(input.extensions ? { extensions: input.extensions } : {}),
          ...(input.invocationContext
            ? { invocationContext: input.invocationContext }
            : {}),
        },
        workspaceBinding: ownerWorkspaceBinding,
      });
      const generation = resolved.runtimeSession.currentGeneration;
      if (!generation)
        throw new RuntimeExecutionError(
          'Runtime session resolved without an active provider generation.',
        );
      executionSession = resolved.session;
      workspaceBinding = generation.workspaceBinding;
      sessionBinding = generation.sessionBinding;
      sessionResolution = resolved.resolution;
      closeAfterTurn = true;
    } else if (input.compatibilitySessionBinding) {
      const durable =
        await this.runtimeSessionLookup.findByExecutionSessionBinding(
          input.compatibilitySessionBinding,
        );
      if (durable) {
        const resolved = await this.#resolver.resolve({
          runtimeSession: durable,
          runId: input.runId,
          spec: {
            workspace: {
              cwd,
              ...(input.workspaceTitle ? { title: input.workspaceTitle } : {}),
            },
            ...(input.provider ? { provider: input.provider } : {}),
            ...(input.model ? { model: input.model } : {}),
            systemPrompt: input.systemPrompt ?? '',
            ...(input.extensions ? { extensions: input.extensions } : {}),
            ...(input.invocationContext
              ? { invocationContext: input.invocationContext }
              : {}),
          },
          workspaceBinding: ownerWorkspaceBinding,
        });
        const generation = resolved.runtimeSession.currentGeneration;
        if (!generation)
          throw new RuntimeExecutionError(
            'Durable execution session resolved without an active provider generation.',
          );
        executionSession = resolved.session;
        workspaceBinding = generation.workspaceBinding;
        sessionBinding = generation.sessionBinding;
        sessionResolution = resolved.resolution;
        closeAfterTurn = true;
      } else {
        const cached = this.#freshSessions.get(
          input.compatibilitySessionBinding.externalSessionId,
        );
        if (!cached)
          throw new RuntimeExecutionError(
            'The execution session binding is unavailable.',
          );
        executionSession = cached.session;
        workspaceBinding = cached.workspaceBinding;
        sessionBinding = cached.sessionBinding;
      }
    } else {
      if (!input.systemPrompt)
        throw new RuntimeExecutionError(
          'Fresh execution requires a system prompt.',
        );
      const created = await this.plane.createSession({
        runtimeSessionId: `run:${input.runId}`,
        workspace: {
          cwd,
          ...(ownerWorkspaceBinding ? { binding: ownerWorkspaceBinding } : {}),
          ...(input.workspaceTitle ? { title: input.workspaceTitle } : {}),
        },
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        systemPrompt: input.systemPrompt,
        ...(input.sessionTitle ? { title: input.sessionTitle } : {}),
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.extensions ? { extensions: input.extensions } : {}),
        ...(input.invocationContext
          ? { invocationContext: input.invocationContext }
          : {}),
      });
      executionSession = created.session;
      workspaceBinding = created.workspaceBinding;
      sessionBinding = created.sessionBinding;
      this.#freshSessions.set(sessionBinding.externalSessionId, {
        session: executionSession,
        sessionBinding,
        workspaceBinding,
      });
    }

    const useRecoveryPrompt = Boolean(
      recoveryPrompt && sessionResolution === 'replaced',
    );
    const prompt = useRecoveryPrompt ? recoveryPrompt! : normalPrompt;

    try {
      const result = await this.runRegistry.run(
        executionSession,
        { runId: input.runId, prompt },
        observer,
      );
      if (result.status === 'cancelled')
        throw new RuntimeExecutionError('The runtime execution was cancelled.');
      if (result.status === 'failed') {
        if (result.failure.code === 'runtime_timeout')
          throw new RuntimeTimedOutError(result.failure.message);
        throw new RuntimeExecutionError(result.failure.message);
      }
      const candidates = await candidateSession.collect();
      return {
        provider: result.output.provider,
        model: result.output.model,
        text: result.output.text,
        workspaceBinding,
        sessionBinding,
        ...(sessionResolution ? { sessionResolution } : {}),
        ...(useRecoveryPrompt ? { usedRecoveryPrompt: true } : {}),
        ...(result.output.usage ? { usage: result.output.usage } : {}),
        ...(candidates.length > 0 ? { memoryCandidates: candidates } : {}),
      };
    } catch (error) {
      if (error instanceof RuntimeTimedOutError) {
        this.logger?.log('warn', 'runtime.session.timeout_diagnostics', {
          run_id: input.runId,
          resolution: sessionResolution ?? 'fresh',
          durable_runtime_session: input.runtimeSessionId !== undefined,
          extensions_present: input.extensions !== undefined,
          extension_grant_id_prefix: input.extensions?.grantId
            ? `${input.extensions.grantId.slice(0, 8)}…`
            : null,
          extension_digest_prefix: input.extensions?.digest
            ? `${input.extensions.digest.slice(0, 12)}…`
            : null,
          extension_endpoint_epoch: input.extensions?.endpointEpoch ?? null,
        });
      }
      throw error;
    } finally {
      if (closeAfterTurn) await executionSession.close().catch(() => undefined);
    }
  }

  async #resolveWorkspaceBinding(
    input: ExecutionTurnRequest,
  ): Promise<ExecutionWorkspaceBinding | null> {
    if (input.workspaceBinding) return input.workspaceBinding;
    const owner = input.workspaceOwner;
    if (!owner) return null;
    const common = {
      tenantId: owner.tenantId,
      productWorkspaceId: owner.productWorkspaceId,
      principalType: owner.principalType,
      principalId: owner.principalId,
    };
    const workspace =
      owner.kind === 'team_run'
        ? await this.runtimeWorkspaces.findForTeamRun({
            ...common,
            teamRunId: owner.id,
          })
        : await this.runtimeWorkspaces.findForProductSession({
            ...common,
            productSessionId: owner.id,
          });
    return workspace.binding;
  }

  public async cancelRun(input: {
    readonly runId: string;
    readonly compatibilitySessionBinding?: ExecutionSessionBinding;
  }): Promise<void> {
    if (this.runRegistry.has(input.runId)) {
      await this.runRegistry.cancel(input.runId);
      return;
    }
    const binding = input.compatibilitySessionBinding;
    if (!binding) return;
    const cached = this.#freshSessions.get(binding.externalSessionId);
    if (cached?.session.cancel)
      await cached.session.cancel(input.runId).catch(() => undefined);
  }

  public planeHealth(): Promise<ExecutionPlaneHealth> {
    return this.plane.health();
  }

  public async close(): Promise<void> {
    for (const cached of this.#freshSessions.values())
      await cached.session.close().catch(() => undefined);
    this.#freshSessions.clear();
    await this.plane.close();
  }

  public async initialize(): Promise<void> {
    const initializable = this.plane as ExecutionPlanePort & {
      initialize?: () => Promise<void>;
    };
    if (initializable.initialize) await initializable.initialize();
    else await this.plane.health();
  }
}
