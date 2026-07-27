import type {
  AgentRuntimeExecution,
  AgentRuntimeExecuteInput,
  AgentRuntimeHealth,
  AgentRuntimePort,
} from '../../src/application/ports/agent-runtime.js';

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

export class FakeAgentRuntime implements AgentRuntimePort {
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

  public async execute(
    input: AgentRuntimeExecuteInput,
  ): Promise<AgentRuntimeExecution> {
    this.executeCalls += 1;
    this.executionRunIds.push(input.runId);
    this.prompts.push(input.prompt);
    if (input.operation === 'create') {
      this.systemPrompts.push(input.systemPrompt);
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

  public async cancel(input: { readonly runId: string }): Promise<void> {
    this.cancelCalls += 1;
    this.cancelledRunIds.push(input.runId);
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}
