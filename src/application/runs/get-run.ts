import type { Run } from '../../domain/runs/run.js';
import type { RunRepository } from '../ports/run-repository.js';

export class GetRun {
  public constructor(private readonly repository: RunRepository) {}

  public execute(id: string): Promise<Run | null> {
    return this.repository.findById(id);
  }
}
