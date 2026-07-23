import { randomUUID } from 'node:crypto';

import { assertRunTransition, type RunStatus } from './run-status.js';

export interface RunUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly totalCostUsd?: number;
  readonly contextWindowMaxTokens?: number;
  readonly contextWindowUsedTokens?: number;
}

export interface RunRuntime {
  readonly provider: string;
  readonly model: string;
}

export interface RunResult {
  readonly text: string;
}

export interface RunFailure {
  readonly code: 'runtime_execution_failed' | 'runtime_timed_out' | 'cancelled';
  readonly message: string;
}

export interface Run {
  readonly id: string;
  readonly prompt: string;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runtime?: RunRuntime;
  readonly result?: RunResult;
  readonly usage?: RunUsage;
  readonly error?: RunFailure;
}

export type RunSnapshot = Run;

export function createRun(
  prompt: string,
  options: {
    readonly id?: string;
    readonly now?: () => Date;
  } = {},
): Run {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();

  return Object.freeze({
    id: options.id ?? randomUUID(),
    prompt,
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function rehydrateRun(snapshot: RunSnapshot): Run {
  assertRunTimestamps(snapshot);
  return Object.freeze({ ...snapshot });
}

export function transitionRun(
  run: Run,
  status: RunStatus,
  patch: Partial<Pick<Run, 'runtime' | 'result' | 'usage' | 'error'>> = {},
  now: () => Date = () => new Date(),
): Run {
  assertRunTransition(run.status, status);

  return Object.freeze({
    ...run,
    ...patch,
    status,
    updatedAt: now().toISOString(),
  });
}

function assertRunTimestamps(run: RunSnapshot): void {
  const createdAt = Date.parse(run.createdAt);
  const updatedAt = Date.parse(run.updatedAt);

  if (Number.isNaN(createdAt) || Number.isNaN(updatedAt)) {
    throw new Error('Run timestamps must be valid ISO-8601 instants');
  }

  if (updatedAt < createdAt) {
    throw new Error('Run updatedAt must be greater than or equal to createdAt');
  }
}
