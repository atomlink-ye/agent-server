import { describe, expect, it } from 'vitest';

import { createRun, type Run } from '../../domain/runs/run.js';
import { createRootTask, type Task } from '../../domain/tasks/task.js';
import type {
  AdmissionRecord,
  AdmissionRepository,
  AdmissionTransaction,
} from '../ports/admission-repository.js';
import { AdmissionAlreadyExistsError as AdmissionRaceError } from '../ports/admission-repository.js';
import type {
  ClaimedRun,
  ClaimNextQueuedRunOptions,
  CompleteClaimedRunOptions,
  RunRepository,
  SaveRunOptions,
} from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { AdmitRootTask } from './admit-root-task.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

describe('AdmitRootTask', () => {
  it('reuses the accepted admission after a same-key save race', async () => {
    const normalizedRequest = normalizeRootTaskRunRequest({
      prompt: 'same prompt',
    });
    const fingerprint = fingerprintRootTaskRunRequest(normalizedRequest);
    const existingTask = createRootTask({
      ingress: 'api',
      invokableKind: 'agent',
      invokableVersionId: 'baseline-run-api',
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef(normalizedRequest),
      inputFingerprint: fingerprint,
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });
    const existingRun = createRun('same prompt', {
      id: '00000000-0000-4000-8000-000000000010',
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });
    const repository = new RaceAdmissionRepository(
      existingTask,
      existingRun,
      fingerprint,
    );
    const useCase = new AdmitRootTask(
      repository.tasksRepository,
      repository.runsRepository,
      repository,
      () => new Date('2026-07-22T12:00:00.000Z'),
    );

    const result = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
    });

    expect(result).toEqual({
      taskId: existingTask.id,
      runId: existingRun.id,
      reused: true,
    });
    expect(repository.saveAttempts).toBe(1);
    expect(repository.enqueuedRunIds).toEqual([]);
  });
});

class RaceAdmissionRepository implements AdmissionRepository {
  public readonly tasksRepository = new InMemoryTaskRepository();
  public readonly runsRepository = new InMemoryRunRepository();
  public saveAttempts = 0;
  public readonly enqueuedRunIds: string[] = [];
  readonly #record: AdmissionRecord;
  #visible = false;

  public constructor(task: Task, run: Run, fingerprint: string) {
    this.#record = {
      ingress: 'api',
      idempotencyKey: 'same-key',
      requestFingerprint: fingerprint,
      taskId: task.id,
      createdAt: task.createdAt,
    };
    this.tasksRepository.seed(task);
    this.runsRepository.seed(task.id, run);
  }

  public async withTransaction<T>(
    work: (transaction: AdmissionTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      tasks: this.tasksRepository,
      runs: this.runsRepository,
      findByIngressAndIdempotencyKey: async () =>
        this.#visible ? this.#record : null,
      save: async () => {
        this.saveAttempts += 1;
        this.#visible = true;
        throw new AdmissionRaceError();
      },
      enqueueRunDispatch: async (runId: string) => {
        this.enqueuedRunIds.push(runId);
      },
    });
  }
}

class InMemoryTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, Task>();

  public seed(task: Task): void {
    this.#tasks.set(task.id, task);
  }

  public async save(task: Task): Promise<void> {
    this.#tasks.set(task.id, task);
  }

  public async findById(id: string): Promise<Task | null> {
    return this.#tasks.get(id) ?? null;
  }
}

class InMemoryRunRepository implements RunRepository {
  readonly #runsById = new Map<string, Run>();
  readonly #runIdsByTaskId = new Map<string, string>();

  public seed(taskId: string, run: Run): void {
    this.#runsById.set(run.id, run);
    this.#runIdsByTaskId.set(taskId, run.id);
  }

  public async save(run: Run, options?: SaveRunOptions): Promise<void> {
    this.#runsById.set(run.id, run);
    if (options?.taskId) {
      this.#runIdsByTaskId.set(options.taskId, run.id);
    }
  }

  public async findById(id: string): Promise<Run | null> {
    return this.#runsById.get(id) ?? null;
  }

  public async findByTaskId(taskId: string): Promise<Run | null> {
    const runId = this.#runIdsByTaskId.get(taskId);
    return runId ? (this.#runsById.get(runId) ?? null) : null;
  }

  public async claimNextQueued(
    _options: ClaimNextQueuedRunOptions,
  ): Promise<ClaimedRun | null> {
    throw new Error('Not implemented in admission tests');
  }

  public async completeClaimed(
    _options: CompleteClaimedRunOptions,
  ): Promise<Run> {
    throw new Error('Not implemented in admission tests');
  }
}
