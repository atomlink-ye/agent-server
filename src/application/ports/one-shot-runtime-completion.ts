import type { ExecutionOutput } from './runtime-execution-session.js';

/** Explicit provider-owned one-shot completion; it has no durable session or grant authority. */
export interface OneShotRuntimeCompletion {
  complete(input: {
    readonly systemPrompt: string;
    readonly prompt: string;
  }): Promise<ExecutionOutput>;
}
