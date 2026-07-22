import type { Run } from '../../domain/runs/run.js';

export interface RunRepository {
  save(run: Run): Promise<void>;
  findById(id: string): Promise<Run | null>;
}
