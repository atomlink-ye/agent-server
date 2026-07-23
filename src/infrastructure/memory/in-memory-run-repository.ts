import type {
  ClaimedRun,
  ClaimQueuedRunByIdOptions,
  ClaimNextQueuedRunOptions,
  CompleteClaimedRunOptions,
  RunOwnerScope,
  RunRepository,
  SaveRunOptions,
  CancellationRequestResult,
} from '../../application/ports/run-repository.js';
import type { Run } from '../../domain/runs/run.js';

export class InMemoryRunRepository implements RunRepository {
  readonly #runs = new Map<string, Run>();
  readonly #taskRuns = new Map<string, string>();
  readonly #cancellationRequested = new Set<string>();

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

  public async requestCancellation(
    taskId: string,
    _requestedAt: string,
  ): Promise<CancellationRequestResult | null> {
    const runId = this.#taskRuns.get(taskId);
    const run = runId ? this.#runs.get(runId) : undefined;
    if (!run || !runId) return null;
    if (run.status === 'queued') {
      this.#runs.set(runId, {
        ...run,
        status: 'cancelled',
        error: { code: 'cancelled', message: 'The run was cancelled.' },
      });
      return { runId, outcome: 'queued_cancelled' };
    }
    if (run.status !== 'running') return { runId, outcome: 'terminal' };
    if (this.#cancellationRequested.has(runId))
      return { runId, outcome: 'running_already_requested' };
    this.#cancellationRequested.add(runId);
    return { runId, outcome: 'running_requested' };
  }

  public async claimNextQueued(
    _options: ClaimNextQueuedRunOptions,
  ): Promise<ClaimedRun | null> {
    throw new Error('InMemoryRunRepository does not implement durable claim');
  }

  public async claimQueuedById(
    _options: ClaimQueuedRunByIdOptions,
  ): Promise<ClaimedRun | null> {
    throw new Error('InMemoryRunRepository does not implement durable claim');
  }

  public async completeClaimed(
    options: CompleteClaimedRunOptions,
  ): Promise<Run> {
    const current = this.#runs.get(options.run.id);
    if (!current || current.status !== 'running') {
      throw new Error('InMemoryRunRepository completion conflict');
    }
    let completed = options.run;
    if (this.#cancellationRequested.has(options.run.id)) {
      const { result: _result, ...withoutResult } = options.run;
      completed = {
        ...withoutResult,
        status: 'cancelled',
        error: { code: 'cancelled', message: 'The run was cancelled.' },
      };
    }
    this.#runs.set(options.run.id, completed);
    return structuredClone(completed);
  }
}
