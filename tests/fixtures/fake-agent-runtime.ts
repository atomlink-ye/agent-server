import type {
  AgentRuntimeExecution,
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
}

export class FakeAgentRuntime implements AgentRuntimePort {
  public initializeCalls = 0;
  public executeCalls = 0;
  public closeCalls = 0;
  public cancelCalls = 0;
  public readonly cancelledRunIds: string[] = [];
  public readonly prompts: string[] = [];
  public ready: boolean;
  readonly #options: FakeRuntimeOptions;

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

  public async execute(input: {
    readonly runId: string;
    readonly prompt: string;
  }): Promise<AgentRuntimeExecution> {
    this.executeCalls += 1;
    this.prompts.push(input.prompt);
    if (this.#options.delayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.#options.delayMs),
      );
    }
    if (this.#options.error) {
      throw this.#options.error;
    }
    return {
      provider: 'opencode',
      model: 'opencode/fake-free',
      text:
        this.#options.responseTexts?.[this.executeCalls - 1] ??
        this.#options.responseText ??
        'FAKE_RUNTIME_OK',
      usage: { inputTokens: 3, outputTokens: 2, totalCostUsd: 0 },
      ...(this.#options.memoryCandidates
        ? { memoryCandidates: this.#options.memoryCandidates }
        : {}),
    };
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
