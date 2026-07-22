import type {
  ClaimedRun,
  ClaimNextQueuedRunOptions,
  CompleteClaimedRunOptions,
  RunOwnerScope,
  RunRepository,
  SaveRunOptions,
} from '../../application/ports/run-repository.js';
import type { Run } from '../../domain/runs/run.js';

export class InMemoryRunRepository implements RunRepository {
  readonly #runs = new Map<string, Run>();
  readonly #taskRuns = new Map<string, string>();

  public async save(run: Run, options: SaveRunOptions = {}): Promise<void> {
    const existingTaskRunId = [...this.#taskRuns.entries()].find(
      ([, runId]) => runId === run.id,
    );

    if (options.taskId) {
      this.#taskRuns.set(options.taskId, run.id);
    } else if (!existingTaskRunId) {
      throw new Error('Saving a new in-memory run requires taskId metadata');
    }

    this.#runs.set(run.id, structuredClone(run));
  }

  public async findById(id: string): Promise<Run | null> {
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : null;
  }

  public async findByIdForOwner(
    _id: string,
    _ownerScope: RunOwnerScope,
  ): Promise<Run | null> {
    throw new Error(
      'InMemoryRunRepository does not support owner-scoped reads because stored runs do not retain authoritative owner scope',
    );
  }

  public async findByTaskId(taskId: string): Promise<Run | null> {
    const runId = this.#taskRuns.get(taskId);
    return runId ? this.findById(runId) : null;
  }

  public async claimNextQueued(
    _options: ClaimNextQueuedRunOptions,
  ): Promise<ClaimedRun | null> {
    throw new Error('InMemoryRunRepository does not implement durable claim');
  }

  public async completeClaimed(
    _options: CompleteClaimedRunOptions,
  ): Promise<Run> {
    throw new Error(
      'InMemoryRunRepository does not implement durable completion',
    );
  }
}
