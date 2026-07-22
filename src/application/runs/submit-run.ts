import { createRun, type Run } from '../../domain/runs/run.js';
import type { RunRepository } from '../ports/run-repository.js';

export class SubmitRun {
  public constructor(private readonly repository: RunRepository) {}

  public async execute(prompt: string): Promise<Run> {
    const run = createRun(prompt);
    await this.repository.save(run);
    return run;
  }
}
