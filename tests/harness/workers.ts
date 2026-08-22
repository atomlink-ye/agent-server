export type {
  StepWorker,
  WorkerStepResult,
} from '../../src/shared/workers/step-worker.js';

import type {
  StepWorker,
  WorkerStepResult,
} from '../../src/shared/workers/step-worker.js';

export async function stepWorker<T>(
  worker: StepWorker<T>,
): Promise<WorkerStepResult<T>> {
  return worker.step();
}

/**
 * Bounded deterministic drain for scenarios that intentionally need more than
 * one queued item. It never sleeps and never starts the production polling loop.
 */
export async function drainWorker<T>(
  worker: StepWorker<T>,
  maxSteps = 100,
): Promise<readonly WorkerStepResult<T>[]> {
  const results: WorkerStepResult<T>[] = [];
  for (let index = 0; index < maxSteps; index += 1) {
    const result = await worker.step();
    results.push(result);
    if (result.kind === 'idle') return results;
  }
  throw new Error(
    `worker did not become idle within ${maxSteps} deterministic steps`,
  );
}
