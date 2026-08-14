import {
  type AgentRuntimeExecuteInput,
  type AgentRuntimeExecution,
  type AgentRuntimeHealth,
  type AgentRuntimePort,
  type RuntimeEvent,
  type RuntimeEventSink,
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from '../ports/agent-runtime.js';
import type {
  ExecutionExtensionBinding,
  ExecutionObservation,
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
  RuntimeSessionLookup,
  RuntimeSessionRepository,
} from '../ports/runtime-session-repository.js';
import type { RuntimeWorkspaceRepository } from '../ports/runtime-workspace-repository.js';
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
  readonly proposalLimit?: number;
}

export interface ExecutionTurnOutcome {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly workspaceBinding: ExecutionWorkspaceBinding;
  readonly sessionBinding: ExecutionSessionBinding;
  readonly usage?: AgentRuntimeExecution['usage'];
  readonly memoryCandidates?: readonly RuntimeMemoryCandidate[];
}

export interface ExecutionRuntimeService {
  ensureReady(): Promise<boolean>;
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

/**
 * Application service over ExecutionPlanePort. It owns runtime placement and
 * session reuse policy but no Paseo SDK/wire logic. AgentRuntimePort methods are
 * temporary compatibility for the last legacy callers/tests.
 */
export class ExecutionPlaneRuntimeFacade
  implements ExecutionRuntimeService, AgentRuntimePort
{
  readonly #resolver: ExecutionSessionResolver;
  readonly #freshSessions = new Map<string, CachedFreshSession>();

  public constructor(
    private readonly plane: ExecutionPlanePort,
    runtimeSessions: RuntimeSessionRepository,
    private readonly runtimeSessionLookup: RuntimeSessionLookup,
    private readonly runtimeWorkspaces: RuntimeWorkspaceRepository,
    private readonly runRegistry: ExecutionRunRegistry,
    private readonly memoryCandidates: RuntimeMemoryCandidateCollector,
    private readonly defaultCwd: string,
  ) {
    this.#resolver = new ExecutionSessionResolver(plane, runtimeSessions);
  }

  public async ensureReady(): Promise<boolean> {
    try {
      await this.initialize();
      return (await this.plane.health()).ready;
    } catch {
      return false;
    }
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
    const prompt = candidateSession.decoratePrompt(input.prompt);

    let executionSession: ExecutionSession;
    let workspaceBinding: ExecutionWorkspaceBinding;
    let sessionBinding: ExecutionSessionBinding;
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
        },
        workspaceBinding: ownerWorkspaceBinding,
      });
      if (
        !resolved.runtimeSession.workspaceBinding ||
        !resolved.runtimeSession.sessionBinding
      )
        throw new RuntimeExecutionError(
          'Runtime session resolved without complete execution bindings.',
        );
      executionSession = resolved.session;
      workspaceBinding = resolved.runtimeSession.workspaceBinding;
      sessionBinding = resolved.runtimeSession.sessionBinding;
      closeAfterTurn = true;
    } else if (input.compatibilitySessionBinding) {
      const cached = this.#freshSessions.get(
        input.compatibilitySessionBinding.externalSessionId,
      );
      if (!cached)
        throw new RuntimeExecutionError(
          'The non-durable compatibility session is no longer attached in this process.',
        );
      executionSession = cached.session;
      workspaceBinding = cached.workspaceBinding;
      sessionBinding = cached.sessionBinding;
    } else {
      if (!input.systemPrompt)
        throw new RuntimeExecutionError('Fresh execution requires a system prompt.');
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
        ...(result.output.usage ? { usage: result.output.usage } : {}),
        ...(candidates.length > 0 ? { memoryCandidates: candidates } : {}),
      };
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

  public async execute(
    input: AgentRuntimeExecuteInput,
    sink?: RuntimeEventSink,
  ): Promise<AgentRuntimeExecution> {
    const outcome = await this.executeTurn(
      {
        runId: input.runId,
        prompt: input.prompt,
        ...(input.runtimeSessionId
          ? { runtimeSessionId: input.runtimeSessionId }
          : {}),
        ...(input.cellCwd ? { cwd: input.cellCwd } : {}),
        ...(input.runtimeWorkspaceId
          ? {
              workspaceBinding: {
                plane: 'paseo',
                externalWorkspaceId: input.runtimeWorkspaceId,
              },
            }
          : {}),
        ...(input.operation === 'continue'
          ? {
              compatibilitySessionBinding: {
                plane: 'paseo',
                externalSessionId: input.providerAgentId,
              },
            }
          : {}),
        ...(input.operation === 'create' && input.workspaceTitle
          ? { workspaceTitle: input.workspaceTitle }
          : {}),
        ...(input.operation === 'create' && input.agentTitle
          ? { sessionTitle: input.agentTitle }
          : {}),
        ...(input.operation === 'create' && input.agentLabels
          ? { labels: input.agentLabels }
          : {}),
        ...(input.operation === 'create' && input.provider
          ? { provider: input.provider, model: input.model }
          : {}),
        ...(input.operation === 'create'
          ? { systemPrompt: input.systemPrompt }
          : {}),
        ...(input.operation === 'create' && input.extensions
          ? { extensions: input.extensions }
          : {}),
        ...(input.memoryCandidates?.proposalLimit !== undefined
          ? { proposalLimit: input.memoryCandidates.proposalLimit }
          : {}),
      },
      sink ? compatibilityObservationSink(sink) : undefined,
    );
    if (input.operation === 'create' && input.onProviderBinding)
      await input.onProviderBinding({
        providerAgentId: outcome.sessionBinding.externalSessionId,
        runtimeWorkspaceId: outcome.workspaceBinding.externalWorkspaceId,
      });
    return {
      provider: outcome.provider,
      model: outcome.model,
      text: outcome.text,
      providerAgentId: outcome.sessionBinding.externalSessionId,
      runtimeWorkspaceId: outcome.workspaceBinding.externalWorkspaceId,
      ...(outcome.usage ? { usage: outcome.usage } : {}),
      ...(outcome.memoryCandidates
        ? { memoryCandidates: outcome.memoryCandidates }
        : {}),
    };
  }

  public cancel(input: {
    readonly runId: string;
    readonly providerAgentId?: string;
  }): Promise<void> {
    return this.cancelRun({
      runId: input.runId,
      ...(input.providerAgentId
        ? {
            compatibilitySessionBinding: {
              plane: 'paseo',
              externalSessionId: input.providerAgentId,
            },
          }
        : {}),
    });
  }

  public async health(): Promise<AgentRuntimeHealth> {
    const health = await this.planeHealth();
    return {
      ready: health.ready,
      provider: health.provider ?? health.plane,
      ...(health.model ? { model: health.model } : {}),
      checks: health.checks,
    };
  }
}

function compatibilityObservationSink(
  sink: RuntimeEventSink,
): ExecutionObservationSink {
  return {
    async emit(observation) {
      const event = runtimeEventFromObservation(observation);
      if (event) await sink.emit(event);
    },
  };
}

function runtimeEventFromObservation(
  observation: ExecutionObservation,
): RuntimeEvent | null {
  switch (observation.kind) {
    case 'turn_started':
    case 'turn_completed':
    case 'turn_failed':
      return null;
    case 'assistant_updated':
      return { kind: 'assistant_text', text: observation.text };
    case 'reasoning_updated':
      return {
        kind: 'reasoning_progress',
        status: observation.status,
        ...(observation.text ? { text: observation.text } : {}),
      };
    case 'tool_updated':
      return {
        kind: 'tool_status',
        activityId: observation.activityId,
        category: observation.category,
        status: observation.status,
        label: observation.label,
        summary: observation.summary,
        ...(observation.toolName ? { toolName: observation.toolName } : {}),
        ...(observation.resultObserved !== undefined
          ? { resultObserved: observation.resultObserved }
          : {}),
        ...(observation.parentActivityId
          ? { parentActivityId: observation.parentActivityId }
          : {}),
        provider: observation.provider,
        ...(observation.detail ? { detail: observation.detail } : {}),
        ...(observation.error ? { error: observation.error } : {}),
      };
    case 'child_activity_updated':
      return {
        kind: 'child_timeline_item',
        parentActivityId: observation.parentActivityId,
        activityId: observation.activityId,
        itemKind: observation.itemKind,
        status: observation.status,
        label: observation.label,
        summary: observation.summary,
        provider: observation.provider,
        ...(observation.text ? { text: observation.text } : {}),
        ...(observation.detail ? { detail: observation.detail } : {}),
        ...(observation.error ? { error: observation.error } : {}),
      };
    case 'permission_updated':
      return {
        kind: 'permission',
        activityId: observation.activityId,
        category: observation.category,
        status: observation.status,
        ...(observation.decision ? { decision: observation.decision } : {}),
        summary: observation.summary,
      };
    case 'usage_updated':
      return {
        kind: 'usage',
        ...(observation.usage.totalCostUsd !== undefined
          ? { totalCostUsd: observation.usage.totalCostUsd }
          : {}),
        ...(observation.usage.inputTokens !== undefined
          ? { inputTokens: observation.usage.inputTokens }
          : {}),
        ...(observation.usage.cachedInputTokens !== undefined
          ? { cachedInputTokens: observation.usage.cachedInputTokens }
          : {}),
        ...(observation.usage.outputTokens !== undefined
          ? { outputTokens: observation.usage.outputTokens }
          : {}),
        ...(observation.usage.contextWindowMaxTokens !== undefined
          ? { contextWindowMaxTokens: observation.usage.contextWindowMaxTokens }
          : {}),
        ...(observation.usage.contextWindowUsedTokens !== undefined
          ? { contextWindowUsedTokens: observation.usage.contextWindowUsedTokens }
          : {}),
      };
    default:
      return assertNever(observation);
  }
}

function assertNever(observation: never): null {
  throw new Error(`Unhandled execution observation ${String(observation)}`);
}
