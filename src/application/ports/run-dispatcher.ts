import type { StepWorker } from '../../shared/workers/step-worker.js';

export interface RunDispatcher extends StepWorker {
  start(): void;
  stop(): Promise<void>;
}
