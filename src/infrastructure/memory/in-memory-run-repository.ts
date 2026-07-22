import type { RunRepository } from '../../application/ports/run-repository.js';
import type { Run } from '../../domain/runs/run.js';

export class InMemoryRunRepository implements RunRepository {
  readonly #runs = new Map<string, Run>();

  public async save(run: Run): Promise<void> {
    this.#runs.set(run.id, structuredClone(run));
  }

  public async findById(id: string): Promise<Run | null> {
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : null;
  }
}
