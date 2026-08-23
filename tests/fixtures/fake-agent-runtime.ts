import type { RuntimeMemoryCandidateCategory } from '../../src/application/ports/runtime-memory-candidate-collector.js';
import type {
  RuntimeSession,
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../src/domain/runtime/runtime-session.js';
import type { ExecutionObservationSink } from '../../src/application/ports/runtime-execution-session.js';
import type { ExecutionPlaneHealth } from '../../src/application/ports/execution-plane.js';
import type { ExecutionExtensionBinding } from '../../src/application/ports/runtime-extension-binding.js';
import type { ExecuteRuntimeTurnInput } from '../../src/application/runtime/execute-runtime-turn.js';
import type { ExecutionOutput } from '../../src/application/ports/runtime-execution-session.js';

type FakeRuntimeHealth = {
  readonly ready: boolean;
  readonly provider: string;
  readonly model?: string;
  readonly checks: ExecutionPlaneHealth['checks'];
};

type FakeRuntimeExecution = {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly externalSessionId: string;
  readonly runtimeWorkspaceId?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalCostUsd: number;
  };
  readonly memoryCandidates?: readonly {
    readonly content: string;
    readonly category: RuntimeMemoryCandidateCategory;
  }[];
};

type FakeRuntimeExecuteInput = {
  readonly operation: 'create' | 'continue';
  readonly runId: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly externalSessionId?: string;
  readonly runtimeSessionId?: string;
  readonly runtimeWorkspaceId?: string;
  readonly cellCwd?: string;
  readonly workspaceTitle?: string;
  readonly agentTitle?: string;
  readonly agentLabels?: Readonly<Record<string, string>>;
  readonly onSessionBinding?: (binding: {
    readonly externalSessionId: string;
    readonly runtimeWorkspaceId: string;
  }) => Promise<void> | void;
  readonly provider?: string;
  readonly model?: string;
  readonly extensions?: ExecutionExtensionBinding;
  readonly memoryCandidates?: {
    readonly maxCandidates?: number;
    readonly proposalLimit?: number;
  };
};

type FakeTurnInput = {
  readonly runId: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly runtimeSessionId?: string;
  readonly workspaceBinding?: { readonly externalWorkspaceId: string };
  readonly cwd?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly sessionTitle?: string;
  readonly workspaceTitle?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: ExecutionExtensionBinding;
  readonly proposalLimit?: number;
};

type FakeTurnOutput = {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly workspaceBinding: { readonly plane: string; readonly externalWorkspaceId: string };
  readonly sessionBinding: { readonly plane: string; readonly externalSessionId: string };
  readonly usage?: FakeRuntimeExecution['usage'];
  readonly memoryCandidates?: FakeRuntimeExecution['memoryCandidates'];
};

export interface FakeRuntimeOptions {
  readonly ready?: boolean;
  readonly responseText?: string;
  readonly responseTexts?: readonly string[];
  readonly delayMs?: number;
  readonly error?: Error;
  readonly memoryCandidates?: readonly {
    readonly content: string;
    readonly category: RuntimeMemoryCandidateCategory;
  }[];
  readonly canaryPrompt?: string;
  readonly canaryResponseText?: string;
  readonly canaryMemoryCandidates?: readonly {
    readonly content: string;
    readonly category: RuntimeMemoryCandidateCategory;
  }[];
  readonly deriveMemoryResponse?: boolean;
}

export interface FakeRuntimeExecutionRecord {
  readonly runId: string;
  readonly prompt: string;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export class FakeAgentRuntime {
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

  public async complete(input: {
    readonly systemPrompt: string;
    readonly prompt: string;
  }): Promise<{ readonly provider: string; readonly model: string; readonly text: string }> {
    const result = await this.execute({
      operation: 'create',
      runId: `one-shot-${this.executeCalls + 1}`,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
    });
    return { provider: result.provider, model: result.model, text: result.text };
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

  public async ensureAgentChatRuntimeSession(
    input: {
      readonly agentChatRuntimeId: string;
      readonly runtimeEpoch: number;
      readonly agentOwner: { readonly scope: { readonly tenantId: string; readonly workspaceId: string }; readonly principal: { readonly type: string; readonly id: string } };
      readonly agentVersionId: string;
      readonly resolvedSkills: readonly { readonly ref: string; readonly digest: string }[];
      readonly toolRefs: readonly string[];
    },
  ): Promise<RuntimeSession> {
    const now = new Date(0).toISOString();
    return {
      id: input.agentChatRuntimeId as RuntimeSessionId,
      scope: {
        kind: 'agent_chat',
        id: input.agentChatRuntimeId,
        epoch: input.runtimeEpoch,
      },
      owner: {
        tenantId: input.agentOwner.scope.tenantId,
        workspaceId: input.agentOwner.scope.workspaceId,
        principalType: input.agentOwner.principal.type,
        principalId: input.agentOwner.principal.id,
      },
      desiredSpecRevision: 1 as RuntimeSpecRevision,
      status: 'ready',
      currentGenerationId: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
  }

  public execute(input: FakeRuntimeExecuteInput): Promise<FakeRuntimeExecution>;
  public execute(input: ExecuteRuntimeTurnInput): Promise<ExecutionOutput>;
  public async execute(
    input: FakeRuntimeExecuteInput | ExecuteRuntimeTurnInput,
  ): Promise<FakeRuntimeExecution | ExecutionOutput> {
    if (!('operation' in input)) {
      const result = await this.executeTurn({
        runId: input.source.kind === 'run' ? input.source.runId : input.runtimeSessionId,
        prompt: input.prompt,
      });
      return {
        provider: result.provider,
        model: result.model,
        text: result.text,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    }
    this.executeCalls += 1;
    this.executionRunIds.push(input.runId);
    this.prompts.push(input.prompt);
    if (input.operation === 'create') {
      this.systemPrompts.push(input.systemPrompt ?? '');
      await input.onSessionBinding?.({
        externalSessionId: 'fake-agent-1',
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
        externalSessionId: 'fake-agent-1',
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
    input: FakeTurnInput,
    _observer?: ExecutionObservationSink,
  ): Promise<FakeTurnOutput> {
    const creating = input.systemPrompt !== undefined;
    const execution = await this.execute(
      creating
        ? {
            operation: 'create',
            runId: input.runId,
            prompt: input.prompt,
            systemPrompt: input.systemPrompt ?? '',
            ...(input.provider
              ? {
                  provider: input.provider,
                  model: input.model ?? 'opencode/fake-free',
                }
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
            externalSessionId: 'fake-agent-1',
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
        externalSessionId: execution.externalSessionId,
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

  public async health(): Promise<FakeRuntimeHealth> {
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

  public async cancelRun(input: { readonly runId: string }): Promise<void> {
    await this.cancel({ runId: input.runId });
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}
