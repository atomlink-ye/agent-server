import type {
  AgentRuntimeExecuteInput,
  AgentRuntimePort,
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

/**
 * Test/debug-only bridge for callers that inject the pre-refactor runtime fake.
 * Production wiring never uses this adapter.
 */
export class LegacyAgentRuntimeExecutionService
  implements ExecutionRuntimeService
{
  public constructor(private readonly legacy: AgentRuntimePort) {}

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
          operation: 'create',
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
            ? {
                runtimeWorkspaceId:
                  input.workspaceBinding.externalWorkspaceId,
              }
            : {}),
          ...(input.cwd ? { cellCwd: input.cwd } : {}),
          ...(input.workspaceTitle
            ? { workspaceTitle: input.workspaceTitle }
            : {}),
          ...(input.sessionTitle ? { agentTitle: input.sessionTitle } : {}),
          ...(input.labels ? { agentLabels: input.labels } : {}),
          ...(input.extensions ? { extensions: input.extensions } : {}),
          ...(input.proposalLimit !== undefined
            ? { memoryCandidates: { proposalLimit: input.proposalLimit } }
            : {}),
        }
      : {
          operation: 'continue',
          runId: input.runId,
          prompt: input.prompt,
          providerAgentId:
            input.compatibilitySessionBinding?.externalSessionId ??
            'debug-session',
          ...(input.runtimeSessionId
            ? { runtimeSessionId: input.runtimeSessionId }
            : {}),
          ...(input.workspaceBinding
            ? {
                runtimeWorkspaceId:
                  input.workspaceBinding.externalWorkspaceId,
              }
            : {}),
          ...(input.cwd ? { cellCwd: input.cwd } : {}),
          ...(input.proposalLimit !== undefined
            ? { memoryCandidates: { proposalLimit: input.proposalLimit } }
            : {}),
        }) as AgentRuntimeExecuteInput;
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

export function isExecutionRuntimeService(
  value: AgentRuntimePort,
): value is AgentRuntimePort & ExecutionRuntimeService {
  const candidate = value as AgentRuntimePort & Partial<ExecutionRuntimeService>;
  return (
    typeof candidate.ensureReady === 'function' &&
    typeof candidate.executeTurn === 'function' &&
    typeof candidate.cancelRun === 'function' &&
    typeof candidate.planeHealth === 'function'
  );
}
