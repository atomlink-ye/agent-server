import { describe, expect, it } from 'vitest';

import type { AccessContext } from '../control-plane/access-context.js';
import { createRun, type Run } from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { createRootTask, type Task } from '../../domain/tasks/task.js';
import type {
  AdmissionRecord,
  AdmissionRepository,
  AdmissionTransaction,
} from '../ports/admission-repository.js';
import { AdmissionAlreadyExistsError as AdmissionRaceError } from '../ports/admission-repository.js';
import type {
  ClaimedRun,
  ClaimQueuedRunByIdOptions,
  ClaimNextQueuedRunOptions,
  CompleteClaimedRunOptions,
  RunOwnerScope,
  RunRepository,
  SaveRunOptions,
} from '../ports/run-repository.js';
import type {
  TaskOwnerScope,
  TaskRecord,
  TaskRepository,
} from '../ports/task-repository.js';
import { AdmitRootTask } from './admit-root-task.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

const primaryAccessContext = createAccessContext();

describe('AdmitRootTask', () => {
  it('persists authoritative scope on admitted tasks and admissions', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new AdmitRootTask(
      repository.tasksRepository,
      repository.runsRepository,
      repository,
      () => new Date('2026-07-22T12:00:00.000Z'),
    );

    const result = await useCase.execute({
      prompt: 'persist my scope',
      idempotencyKey: 'scope-key',
      accessContext: primaryAccessContext,
    });

    const task = repository.tasksRepository.findPersisted(result.taskId);

    expect(task).toMatchObject({
      id: result.taskId,
      tenantId: primaryAccessContext.tenantId,
      workspaceId: primaryAccessContext.workspaceId,
      principalType: primaryAccessContext.principalType,
      principalId: primaryAccessContext.principalId,
      policySnapshotVersion: primaryAccessContext.policySnapshotVersion,
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
    });
    expect(repository.records).toEqual([
      expect.objectContaining({
        ingress: 'api',
        idempotencyKey: 'scope-key',
        taskId: result.taskId,
        tenantId: primaryAccessContext.tenantId,
        workspaceId: primaryAccessContext.workspaceId,
        principalType: primaryAccessContext.principalType,
        principalId: primaryAccessContext.principalId,
        policySnapshotVersion: primaryAccessContext.policySnapshotVersion,
      }),
    ]);
    expect(repository.enqueuedRunIds).toEqual([result.runId]);
  });

  it('reuses admissions inside the same owner scope even when policy snapshot version changes', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new AdmitRootTask(
      repository.tasksRepository,
      repository.runsRepository,
      repository,
      () => new Date('2026-07-22T12:00:00.000Z'),
    );

    const first = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: createAccessContext({
        policySnapshotVersion: 'policy-v1',
      }),
    });
    const second = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: createAccessContext({
        policySnapshotVersion: 'policy-v2',
      }),
    });

    expect(second).toEqual({ ...first, reused: true });
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.policySnapshotVersion).toBe('policy-v1');
  });

  it('creates separate admissions when the same idempotency key is reused by a different owner scope', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new AdmitRootTask(
      repository.tasksRepository,
      repository.runsRepository,
      repository,
      () => new Date('2026-07-22T12:00:00.000Z'),
    );

    const first = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: createAccessContext(),
    });
    const second = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: createAccessContext({
        principalId: 'svc_beta',
      }),
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(false);
    expect(second.taskId).not.toBe(first.taskId);
    expect(second.runId).not.toBe(first.runId);
    expect(repository.records).toHaveLength(2);
  });

  it('reuses the accepted admission after a same-key save race', async () => {
    const normalizedRequest = normalizeRootTaskRunRequest({
      prompt: 'same prompt',
    });
    const fingerprint = fingerprintRootTaskRunRequest(normalizedRequest);
    const existingTask = createRootTask({
      ...primaryAccessContext,
      ingress: 'api',
      invokableKind: 'agent',
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
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
      accessContext: primaryAccessContext,
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
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
      policySnapshotVersion: task.policySnapshotVersion,
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
      findByIngressAndIdempotencyKey: async (
        _ingress,
        _idempotencyKey,
        scope,
      ) =>
        this.#visible && matchesAdmissionScope(this.#record, scope)
          ? this.#record
          : null,
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

  public findPersisted(id: string): Task | null {
    return this.#tasks.get(id) ?? null;
  }

  public async save(task: Task): Promise<void> {
    this.#tasks.set(task.id, task);
  }

  public async findById(id: string): Promise<Task | null> {
    return this.#tasks.get(id) ?? null;
  }

  public async findByIdForOwner(
    id: string,
    ownerScope: TaskOwnerScope,
  ): Promise<TaskRecord | null> {
    const task = await this.findById(id);
    if (!task || !matchesTaskOwnerScope(task, ownerScope)) {
      return null;
    }

    return { task, latestRun: null };
  }

  public async findByRootTaskIdForOwner(
    rootTaskId: string,
    ownerScope: TaskOwnerScope,
  ): Promise<readonly TaskRecord[]> {
    return Array.from(this.#tasks.values())
      .filter(
        (task) =>
          task.rootTaskId === rootTaskId &&
          matchesTaskOwnerScope(task, ownerScope),
      )
      .map((task) => ({ task, latestRun: null }));
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

  public async findByIdForOwner(
    id: string,
    _ownerScope: RunOwnerScope,
  ): Promise<Run | null> {
    return this.findById(id);
  }

  public async findByTaskId(taskId: string): Promise<Run | null> {
    const runId = this.#runIdsByTaskId.get(taskId);
    return runId ? (this.#runsById.get(runId) ?? null) : null;
  }

  public async requestCancellation(taskId: string, _requestedAt: string) {
    return { runId: taskId, outcome: 'terminal' as const };
  }

  public async claimNextQueued(
    _options: ClaimNextQueuedRunOptions,
  ): Promise<ClaimedRun | null> {
    throw new Error('Not implemented in admission tests');
  }

  public async claimQueuedById(
    _options: ClaimQueuedRunByIdOptions,
  ): Promise<ClaimedRun | null> {
    throw new Error('Not implemented in admission tests');
  }

  public async completeClaimed(
    _options: CompleteClaimedRunOptions,
  ): Promise<Run> {
    throw new Error('Not implemented in admission tests');
  }
}

class InMemoryAdmissionRepository implements AdmissionRepository {
  public readonly tasksRepository = new InMemoryTaskRepository();
  public readonly runsRepository = new InMemoryRunRepository();
  public readonly records: AdmissionRecord[] = [];
  public readonly enqueuedRunIds: string[] = [];

  public async withTransaction<T>(
    work: (transaction: AdmissionTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      tasks: this.tasksRepository,
      runs: this.runsRepository,
      findByIngressAndIdempotencyKey: async (ingress, idempotencyKey, scope) =>
        this.records.find(
          (record) =>
            record.ingress === ingress &&
            record.idempotencyKey === idempotencyKey &&
            matchesAdmissionScope(record, scope),
        ) ?? null,
      save: async (record) => {
        const existing = this.records.find(
          (candidate) =>
            candidate.ingress === record.ingress &&
            candidate.idempotencyKey === record.idempotencyKey &&
            matchesAdmissionScope(candidate, record),
        );

        if (existing) {
          throw new AdmissionRaceError();
        }

        this.records.push(record);
      },
      enqueueRunDispatch: async (runId: string) => {
        this.enqueuedRunIds.push(runId);
      },
    });
  }
}

function createAccessContext(
  overrides: Partial<AccessContext> = {},
): AccessContext {
  return Object.freeze({
    tenantId: 'tenant_alpha',
    workspaceId: 'workspace_main',
    principalType: 'service_account',
    principalId: 'svc_alpha',
    policySnapshotVersion: 'policy-2026-07-22',
    ...overrides,
  });
}

function matchesAdmissionScope(
  record: Pick<
    AdmissionRecord,
    'tenantId' | 'workspaceId' | 'principalType' | 'principalId'
  >,
  scope: Pick<
    AdmissionRecord,
    'tenantId' | 'workspaceId' | 'principalType' | 'principalId'
  >,
): boolean {
  return (
    record.tenantId === scope.tenantId &&
    record.workspaceId === scope.workspaceId &&
    record.principalType === scope.principalType &&
    record.principalId === scope.principalId
  );
}

function matchesTaskOwnerScope(
  task: Task,
  ownerScope: TaskOwnerScope,
): boolean {
  return (
    task.tenantId === ownerScope.tenantId &&
    task.workspaceId === ownerScope.workspaceId &&
    task.principalType === ownerScope.principalType &&
    task.principalId === ownerScope.principalId
  );
}
