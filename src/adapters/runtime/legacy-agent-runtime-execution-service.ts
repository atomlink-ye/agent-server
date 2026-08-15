import type {
  AgentRuntimeExecution,
  AgentRuntimeExecuteInput,
  AgentRuntimeHealth,
} from '../../application/ports/agent-runtime.js';
import type {
  ExecutionObservationSink,
  ExecutionPlaneHealth,
} from '../../application/ports/execution-plane.js';
import type {
  ExecutionRuntimeService,
  ExecutionTurnOutcome,
  ExecutionTurnRequest,
} from '../../application/runtime/execution-plane-runtime-facade.js';

interface LegacyRuntime {
  initialize(): Promise<void>;
  execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecution>;
  cancel?(input: { readonly runId: string }): Promise<void>;
  health(): Promise<AgentRuntimeHealth>;
  close(): Promise<void>;
}

/** Test/debug-only bridge for callers that still provide the legacy shape. */
export class LegacyAgentRuntimeExecutionService
  implements ExecutionRuntimeService
{
  public constructor(private readonly legacy: LegacyRuntime) {}

  public async ensureReady(): Promise<boolean> {
    try {
      if ((await this.legacy.health()).ready) return true;
      await this.legacy.initialize();
      return (await this.legacy.health()).ready;
    } catch {
      return false;
    }
  }

  public async executeTurn(
    input: ExecutionTurnRequest,
    _observer?: ExecutionObservationSink,
  ): Promise<ExecutionTurnOutcome> {
    const creating = input.systemPrompt !== undefined;
    const legacyInput = (creating
      ? {
          operation: 'create' as const,
          runId: input.runId,
          prompt: input.prompt,
          systemPrompt: input.systemPrompt ?? '',
          ...(input.provider
            ? { provider: input.provider, model: input.model ?? 'debug-model' }
            : {}),
          ...(input.runtimeSessionId
            ? { runtimeSessionId: input.runtimeSessionId }
            : {}),
          ...(input.workspaceBinding
            ? { runtimeWorkspaceId: input.workspaceBinding.externalWorkspaceId }
            : {}),
          ...(input.cwd ? { cellCwd: input.cwd } : {}),
          ...(input.workspaceTitle ? { workspaceTitle: input.workspaceTitle } : {}),
          ...(input.sessionTitle ? { agentTitle: input.sessionTitle } : {}),
          ...(input.labels ? { agentLabels: input.labels } : {}),
          ...(input.extensions ? { extensions: input.extensions } : {}),
          ...(input.proposalLimit !== undefined
            ? { memoryCandidates: { proposalLimit: input.proposalLimit } }
            : {}),
        }
      : {
          operation: 'continue' as const,
          runId: input.runId,
          prompt: input.prompt,
          providerAgentId:
            input.compatibilitySessionBinding?.externalSessionId ?? 'debug-session',
          ...(input.runtimeSessionId
            ? { runtimeSessionId: input.runtimeSessionId }
            : {}),
          ...(input.workspaceBinding
            ? { runtimeWorkspaceId: input.workspaceBinding.externalWorkspaceId }
            : {}),
          ...(input.cwd ? { cellCwd: input.cwd } : {}),
          ...(input.proposalLimit !== undefined
            ? { memoryCandidates: { proposalLimit: input.proposalLimit } }
            : {}),
        }) satisfies AgentRuntimeExecuteInput;
    const execution = await this.legacy.execute(legacyInput);
    return {
      provider: execution.provider,
      model: execution.model,
      text: execution.text,
      workspaceBinding: {
        plane: 'legacy-debug',
        externalWorkspaceId:
          execution.runtimeWorkspaceId ??
          input.workspaceBinding?.externalWorkspaceId ??
          'debug-workspace',
      },
      sessionBinding: {
        plane: 'legacy-debug',
        externalSessionId: execution.providerAgentId,
      },
      ...(execution.usage ? { usage: execution.usage } : {}),
      ...(execution.memoryCandidates
        ? { memoryCandidates: execution.memoryCandidates }
        : {}),
    };
  }

  public async cancelRun(input: { readonly runId: string }): Promise<void> {
    await this.legacy.cancel?.({ runId: input.runId });
  }

  public async planeHealth(): Promise<ExecutionPlaneHealth> {
    const health = await this.legacy.health();
    return {
      ready: health.ready,
      plane: 'legacy-debug',
      provider: health.provider,
      ...(health.model ? { model: health.model } : {}),
      checks: health.checks,
    };
  }

  public close(): Promise<void> {
    return this.legacy.close();
  }
}
