import type {
  AgentRuntimeExecution,
  AgentRuntimeExecuteInput,
  AgentRuntimeHealth,
  AgentRuntimePort,
} from '../../src/application/ports/agent-runtime.js';
import type {
  ExecutionObservationSink,
  ExecutionPlaneHealth,
} from '../../src/application/ports/execution-plane.js';
import type {
  ExecutionRuntimeService,
  ExecutionTurnOutcome,
  ExecutionTurnRequest,
} from '../../src/application/runtime/execution-plane-runtime-facade.js';

export interface FakeRuntimeOptions {
  readonly ready?: boolean;
  readonly responseText?: string;
  readonly responseTexts?: readonly string[];
  readonly delayMs?: number;
  readonly error?: Error;
  readonly memoryCandidates?: readonly {
    readonly content: string;
    readonly category: string;
  }[];
  readonly canaryPrompt?: string;
  readonly canaryResponseText?: string;
  readonly canaryMemoryCandidates?: readonly {
    readonly content: string;
    readonly category: string;
  }[];
  readonly deriveMemoryResponse?: boolean;
}

export interface FakeRuntimeExecutionRecord {
  readonly runId: string;
  readonly prompt: string;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export class FakeAgentRuntime
  implements AgentRuntimePort, ExecutionRuntimeService
{
  public initializeCalls = 0;
  public executeCalls = 0;
  public closeCalls = 0;
  public cancelCalls = 0;
  public readonly cancelledRunIds: string[] = [];
  public readonly prompts: string[] = [];
  public readonly systemPrompts: string[] = [];
  public readonly executionRunIds: string[] = [];
  public readonly executions: FakeRuntimeExecutionRecord[] = [];
  public readonly activeRunIds = new Set<string>();
  public ready: boolean;
  readonly #options: FakeRuntimeOptions;
  #executionGate:
    | {
        runId?: string;
        entered: Promise<void>;
        resolveEntered: () => void;
        release: Promise<void>;
        resolveRelease: () => void;
      }
    | undefined;

  public constructor(options: FakeRuntimeOptions = {}) {
    this.#options = options;
    this.ready = options.ready ?? true;
  }

  public async initialize(): Promise<void> {
    this.initializeCalls += 1;
    if (!this.ready) {
      throw new Error('fake runtime unavailable');
    }
  }

  public async ensureReady(): Promise<boolean> {
    if (this.ready) return true;
    try {
      await this.initialize();
      return this.ready;
    } catch {
      return false;
    }
  }

  public async execute(
    input: AgentRuntimeExecuteInput,
  ): Promise<AgentRuntimeExecution> {
    this.executeCalls += 1;
    this.executionRunIds.push(input.runId);
    this.prompts.push(input.prompt);
    if (input.operation === 'create') {
      this.systemPrompts.push(input.systemPrompt);
      await input.onProviderBinding?.({
        providerAgentId: 'fake-agent-1',
        runtimeWorkspaceId: 'fake-runtime-workspace-1',
      });
    }
    this.activeRunIds.add(input.runId);
    const startedAt = Date.now();
    const gate = this.#executionGate;
    if (gate && (gate.runId === undefined || gate.runId === input.runId)) {
      gate.resolveEntered();
      await gate.release;
      this.#executionGate = undefined;
    }
    try {
      if (this.#options.delayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.#options.delayMs),
        );
      }
      if (this.#options.error) {
        throw this.#options.error;
      }
      const isCanary =
        this.#options.canaryPrompt !== undefined &&
        input.prompt.includes(this.#options.canaryPrompt);
      return {
        provider: 'opencode',
        model: 'opencode/fake-free',
        providerAgentId: 'fake-agent-1',
        runtimeWorkspaceId: 'fake-runtime-workspace-1',
        text: isCanary
          ? (this.#options.canaryResponseText ?? 'FAKE_RUNTIME_OK')
          : this.#options.deriveMemoryResponse &&
              input.prompt.includes('Pinned verified MEMORY.md:')
            ? `RECALL_FROM_MEMORY: ${input.prompt.split('Pinned verified MEMORY.md:\n')[1] ?? ''}`
            : (this.#options.responseTexts?.[this.executeCalls - 1] ??
              this.#options.responseText ??
              'FAKE_RUNTIME_OK'),
        usage: { inputTokens: 3, outputTokens: 2, totalCostUsd: 0 },
        ...(isCanary
          ? { memoryCandidates: this.#options.canaryMemoryCandidates ?? [] }
          : this.#options.memoryCandidates
            ? { memoryCandidates: this.#options.memoryCandidates }
            : {}),
      };
    } finally {
      this.activeRunIds.delete(input.runId);
      this.executions.push({
        runId: input.runId,
        prompt: input.prompt,
        startedAt,
        finishedAt: Date.now(),
      });
    }
  }

  public async executeTurn(
    input: ExecutionTurnRequest,
    _observer?: ExecutionObservationSink,
  ): Promise<ExecutionTurnOutcome> {
    const creating = input.systemPrompt !== undefined;
    const execution = await this.execute(
      creating
        ? {
            operation: 'create',
            runId: input.runId,
            prompt: input.prompt,
            systemPrompt: input.systemPrompt ?? '',
            ...(input.provider
              ? { provider: input.provider, model: input.model ?? 'opencode/fake-free' }
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
              'fake-agent-1',
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
          },
    );
    return {
      provider: execution.provider,
      model: execution.model,
      text: execution.text,
      workspaceBinding: {
        plane: 'paseo',
        externalWorkspaceId:
          execution.runtimeWorkspaceId ??
          input.workspaceBinding?.externalWorkspaceId ??
          'fake-runtime-workspace-1',
      },
      sessionBinding: {
        plane: 'paseo',
        externalSessionId: execution.providerAgentId,
      },
      ...(execution.usage ? { usage: execution.usage } : {}),
      ...(execution.memoryCandidates
        ? { memoryCandidates: execution.memoryCandidates }
        : {}),
    };
  }

  public armExecutionGate(runId?: string): {
    readonly entered: Promise<void>;
    readonly release: () => void;
  } {
    let resolveEntered!: () => void;
    let resolveRelease!: () => void;
    const entered = new Promise<void>((resolve) => (resolveEntered = resolve));
    const releasePromise = new Promise<void>(
      (resolve) => (resolveRelease = resolve),
    );
    this.#executionGate = {
      ...(runId === undefined ? {} : { runId }),
      entered,
      resolveEntered,
      release: releasePromise,
      resolveRelease,
    };
    return { entered, release: resolveRelease };
  }

  public async health(): Promise<AgentRuntimeHealth> {
    return {
      ready: this.ready,
      provider: 'opencode',
      ...(this.ready ? { model: 'opencode/fake-free' } : {}),
      checks: [
        {
          name: 'fake_runtime',
          ready: this.ready,
          ...(!this.ready ? { detail: 'fake runtime unavailable' } : {}),
        },
      ],
    };
  }

  public async planeHealth(): Promise<ExecutionPlaneHealth> {
    const health = await this.health();
    return {
      ready: health.ready,
      plane: 'fake',
      provider: health.provider,
      ...(health.model ? { model: health.model } : {}),
      checks: health.checks,
    };
  }

  public async cancel(input: { readonly runId: string }): Promise<void> {
    this.cancelCalls += 1;
    this.cancelledRunIds.push(input.runId);
  }

  public async cancelRun(input: {
    readonly runId: string;
  }): Promise<void> {
    await this.cancel({ runId: input.runId });
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}
