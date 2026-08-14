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
  ExecutionObservation,
  ExecutionObservationSink,
  ExecutionPlanePort,
  ExecutionSession,
  ExecutionSessionBinding,
  ExecutionSessionSpec,
  ExecutionWorkspaceBinding,
} from '../ports/execution-plane.js';
import type { RuntimeMemoryCandidateCollector } from '../ports/runtime-memory-candidate-collector.js';
import type {
  RuntimeSessionLookup,
  RuntimeSessionRepository,
} from '../ports/runtime-session-repository.js';
import { ExecutionRunRegistry } from './execution-run-registry.js';
import { ExecutionSessionResolver } from './execution-session-resolver.js';

interface CachedFreshSession {
  readonly session: ExecutionSession;
  readonly sessionBinding: ExecutionSessionBinding;
  readonly workspaceBinding: ExecutionWorkspaceBinding;
  readonly spec: ExecutionSessionSpec;
}

/**
 * Temporary Application compatibility facade for callers that have not yet
 * adopted ExecutionSession directly. All real execution and external identity
 * ownership flows through ExecutionPlanePort + ExecutionSessionResolver.
 *
 * This class deliberately contains no Paseo SDK/wire logic. It is removable
 * once the remaining legacy call sites use ExecutionSession directly.
 */
export class ExecutionPlaneRuntimeFacade implements AgentRuntimePort {
  readonly #resolver: ExecutionSessionResolver;
  readonly #freshSessions = new Map<string, CachedFreshSession>();

  public constructor(
    private readonly plane: ExecutionPlanePort,
    private readonly runtimeSessions: RuntimeSessionRepository,
    private readonly runtimeSessionLookup: RuntimeSessionLookup,
    private readonly runRegistry: ExecutionRunRegistry,
    private readonly memoryCandidates: RuntimeMemoryCandidateCollector,
    private readonly defaultCwd: string,
  ) {
    this.#resolver = new ExecutionSessionResolver(plane, runtimeSessions);
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
    const cwd = input.cellCwd ?? this.defaultCwd;
    const candidateSession = await this.memoryCandidates.prepare({
      runId: input.runId,
      cwd,
      proposalLimit: input.memoryCandidates?.proposalLimit ?? 0,
    });
    const prompt = candidateSession.decoratePrompt(input.prompt);
    const observer = sink ? compatibilityObservationSink(sink) : undefined;

    let executionSession: ExecutionSession;
    let workspaceBinding: ExecutionWorkspaceBinding;
    let sessionBinding: ExecutionSessionBinding;
    let shouldCloseHandle = false;

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
            ...(input.operation === 'create' && input.workspaceTitle
              ? { title: input.workspaceTitle }
              : {}),
          },
          ...(input.operation === 'create' && input.provider
            ? { provider: input.provider, model: input.model }
            : {}),
          systemPrompt: input.operation === 'create' ? input.systemPrompt : '',
          ...(input.operation === 'create' && input.agentTitle
            ? { title: input.agentTitle }
            : {}),
          ...(input.operation === 'create' && input.agentLabels
            ? { labels: input.agentLabels }
            : {}),
          ...(input.operation === 'create' && input.extensions
            ? { extensions: input.extensions }
            : {}),
        },
        workspaceBinding:
          input.runtimeWorkspaceId !== undefined
            ? {
                plane: 'paseo',
                externalWorkspaceId: input.runtimeWorkspaceId,
              }
            : null,
      });
      executionSession = resolved.session;
      if (!resolved.runtimeSession.workspaceBinding || !resolved.runtimeSession.sessionBinding)
        throw new RuntimeExecutionError(
          'Runtime session resolved without complete execution bindings.',
        );
      workspaceBinding = resolved.runtimeSession.workspaceBinding;
      sessionBinding = resolved.runtimeSession.sessionBinding;
      // Legacy callbacks are notification-only. Durable binding is already
      // persisted by ExecutionSessionResolver before this callback can run.
      if (input.operation === 'create' && input.onProviderBinding)
        await input.onProviderBinding({
          providerAgentId: sessionBinding.externalSessionId,
          runtimeWorkspaceId: workspaceBinding.externalWorkspaceId,
        });
      shouldCloseHandle = true;
    } else if (input.operation === 'continue') {
      const cached = this.#freshSessions.get(input.providerAgentId);
      if (!cached)
        throw new RuntimeExecutionError(
          'The non-durable compatibility session is no longer attached in this process.',
        );
      executionSession = cached.session;
      workspaceBinding = cached.workspaceBinding;
      sessionBinding = cached.sessionBinding;
    } else {
      const created = await this.plane.createSession({
        runtimeSessionId: `run:${input.runId}`,
        workspace: {
          cwd,
          ...(input.runtimeWorkspaceId
            ? {
                binding: {
                  plane: 'paseo',
                  externalWorkspaceId: input.runtimeWorkspaceId,
                },
              }
            : {}),
          ...(input.workspaceTitle ? { title: input.workspaceTitle } : {}),
        },
        ...(input.provider ? { provider: input.provider, model: input.model } : {}),
        systemPrompt: input.systemPrompt,
        ...(input.agentTitle ? { title: input.agentTitle } : {}),
        ...(input.agentLabels ? { labels: input.agentLabels } : {}),
        ...(input.extensions ? { extensions: input.extensions } : {}),
      });
      executionSession = created.session;
      workspaceBinding = created.workspaceBinding;
      sessionBinding = created.sessionBinding;
      this.#freshSessions.set(sessionBinding.externalSessionId, {
        session: executionSession,
        sessionBinding,
        workspaceBinding,
        spec: {
          runtimeSessionId: `run:${input.runId}`,
          workspace: { cwd, binding: workspaceBinding },
          ...(input.provider ? { provider: input.provider, model: input.model } : {}),
          systemPrompt: input.systemPrompt,
        },
      });
      if (input.onProviderBinding)
        await input.onProviderBinding({
          providerAgentId: sessionBinding.externalSessionId,
          runtimeWorkspaceId: workspaceBinding.externalWorkspaceId,
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
        providerAgentId: sessionBinding.externalSessionId,
        runtimeWorkspaceId: workspaceBinding.externalWorkspaceId,
        ...(result.output.usage ? { usage: result.output.usage } : {}),
        ...(candidates.length > 0 ? { memoryCandidates: candidates } : {}),
      };
    } finally {
      if (shouldCloseHandle) await executionSession.close().catch(() => undefined);
    }
  }

  public async cancel(input: {
    readonly runId: string;
    readonly providerAgentId?: string;
  }): Promise<void> {
    if (this.runRegistry.has(input.runId)) {
      await this.runRegistry.cancel(input.runId);
      return;
    }
    if (input.providerAgentId) {
      const cached = this.#freshSessions.get(input.providerAgentId);
      if (cached?.session.cancel)
        await cached.session.cancel(input.runId).catch(() => undefined);
    }
  }

  public async health(): Promise<AgentRuntimeHealth> {
    const health = await this.plane.health();
    return {
      ready: health.ready,
      provider: health.provider ?? health.plane,
      ...(health.model ? { model: health.model } : {}),
      checks: health.checks,
    };
  }

  public async close(): Promise<void> {
    for (const cached of this.#freshSessions.values())
      await cached.session.close().catch(() => undefined);
    this.#freshSessions.clear();
    await this.plane.close();
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
        toolName: observation.toolName,
        resultObserved: observation.resultObserved,
        parentActivityId: observation.parentActivityId,
        provider: observation.provider,
        detail: observation.detail,
        error: observation.error,
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
        text: observation.text,
        detail: observation.detail,
        error: observation.error,
      };
    case 'permission_updated':
      return {
        kind: 'permission',
        activityId: observation.activityId,
        category: observation.category,
        status: observation.status,
        decision: observation.decision,
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
