export type WorkerStepResult<T = unknown> =
  Readonly<{ kind: 'idle' }> | Readonly<{ kind: 'processed'; value?: T }>;

/**
 * Deterministic seam for background workers.
 *
 * Production loops repeatedly call step() and sleep only after an idle result.
 * Tests/scenarios call step() directly so business behavior does not depend on
 * timers, scheduler cadence, or process lifetime.
 */
export interface StepWorker<T = unknown> {
  step(): Promise<WorkerStepResult<T>>;
}
