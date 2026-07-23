import { createHash } from 'node:crypto';

import type { Run } from '../../domain/runs/run.js';
import type { RunStatus } from '../../domain/runs/run-status.js';

export interface RuntimeExecutionReceipt {
  readonly runId: string;
  readonly taskId?: string;
  readonly terminalStatus: Extract<
    RunStatus,
    'succeeded' | 'failed' | 'timed_out'
  >;
  readonly provider?: string;
  readonly model?: string;
  readonly resultAvailable: boolean;
  readonly resultFingerprint?: string;
  readonly completedAt: string;
}

export class RunCompletionPersistenceError extends Error {
  public readonly code = 'terminal_persistence_failed' as const;

  public constructor(public readonly receipt: RuntimeExecutionReceipt) {
    super('Run terminal persistence failed; reconciliation is required.');
    this.name = 'RunCompletionPersistenceError';
  }
}

export class RuntimeMemoryPersistenceError extends Error {
  public readonly code = 'runtime_memory_persistence_failed' as const;

  public constructor(public readonly receipt: RuntimeExecutionReceipt) {
    super('Runtime memory persistence failed; the run remains recoverable.');
    this.name = 'RuntimeMemoryPersistenceError';
  }
}

export function createRuntimeExecutionReceipt(
  run: Run,
  taskId?: string,
): RuntimeExecutionReceipt {
  const terminalStatus = toTerminalStatus(run.status);

  return Object.freeze({
    runId: run.id,
    ...(taskId ? { taskId } : {}),
    terminalStatus,
    ...(run.runtime
      ? { provider: run.runtime.provider, model: run.runtime.model }
      : {}),
    resultAvailable: run.result !== undefined,
    ...(run.result
      ? {
          resultFingerprint: createHash('sha256')
            .update(run.result.text)
            .digest('hex'),
        }
      : {}),
    completedAt: run.updatedAt,
  });
}

function toTerminalStatus(
  status: RunStatus,
): RuntimeExecutionReceipt['terminalStatus'] {
  if (status !== 'succeeded' && status !== 'failed' && status !== 'timed_out') {
    throw new Error(
      `Cannot create runtime execution receipt for ${status} run`,
    );
  }

  return status;
}
