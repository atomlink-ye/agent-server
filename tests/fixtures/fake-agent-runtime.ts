import type {
  AgentRuntimeExecution,
  AgentRuntimeHealth,
  AgentRuntimePort,
} from '../../src/application/ports/agent-runtime.js';

export interface FakeRuntimeOptions {
  readonly ready?: boolean;
  readonly responseText?: string;
  readonly delayMs?: number;
  readonly error?: Error;
}

export class FakeAgentRuntime implements AgentRuntimePort {
  public initializeCalls = 0;
  public executeCalls = 0;
  public closeCalls = 0;
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

  public async execute(): Promise<AgentRuntimeExecution> {
    this.executeCalls += 1;
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
      text: this.#options.responseText ?? 'FAKE_RUNTIME_OK',
      usage: { inputTokens: 3, outputTokens: 2, totalCostUsd: 0 },
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

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}
