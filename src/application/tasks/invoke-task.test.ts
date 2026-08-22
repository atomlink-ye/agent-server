import { describe, expect, it } from 'vitest';

import type { AccessContext } from '../../platform/access-context.js';
import { createRun, type Run } from '../../domain/runs/run.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import { createRootTask, type Task } from '../../domain/tasks/task.js';
import type {
  AdmissionRecord,
  AdmissionRepository,
  AdmissionTransaction,
} from '../ports/admission-repository.js';
import { AdmissionAlreadyExistsError } from '../ports/admission-repository.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
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
import {
  IdempotencyConflictError,
  InvokeTask,
  WorkspaceScopeMismatchError,
} from './invoke-task.js';

const primaryAccessContext = createAccessContext();
const publishedAgentVersion = {
  id: '00000000-0000-4000-8000-0000000a0101',
};
const publishedAgentResolver: AgentResolutionApi = {
  resolvePublished: async (id) =>
    id === publishedAgentVersion.id
      ? {
          source: 'managed',
          id,
          instructions: 'Do the task.',
          modelPolicyRef: 'free-only',
          proposalLimit: 0,
          skills: [],
          toolRefs: [],
        }
      : null,
};

describe('InvokeTask', () => {
  it('reuses the original task when the same key is replayed with the same canonical request', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new InvokeTask(
      repository,
      new PublishedInvokableRepository(),
      publishedAgentResolver,
      () => new Date('2026-07-22T12:10:00.000Z'),
    );

    const first = await useCase.execute({
      idempotencyKey: 'same-key',
      invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
      input: { text: '  same prompt  ' },
      accessContext: primaryAccessContext,
    });
    const second = await useCase.execute({
      idempotencyKey: 'same-key',
      invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
      input: { text: 'same prompt' },
      workspaceId: primaryAccessContext.workspaceId,
      accessContext: primaryAccessContext,
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.task.task.id).toBe(first.task.task.id);
    expect(second.task.latestRun?.runId).toBe(first.task.latestRun?.runId);
  });

  it('reloads a newly admitted task through the transaction task repository', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new InvokeTask(
      repository,
      new PublishedInvokableRepository(),
      publishedAgentResolver,
    );

    const result = await useCase.execute({
      idempotencyKey: 'transaction-visible-new-task',
      invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
      input: { text: 'transaction visible' },
      accessContext: primaryAccessContext,
    });

    expect(result.reused).toBe(false);
    expect(repository.tasksRepository.transactionScopedOwnerReads).toBe(1);
  });

  it('reloads a replayed task through the transaction task repository', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new InvokeTask(
      repository,
      new PublishedInvokableRepository(),
      publishedAgentResolver,
    );
    const first = await useCase.execute({
      idempotencyKey: 'transaction-visible-replay',
      invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
      input: { text: 'transaction visible' },
      accessContext: primaryAccessContext,
    });
    const replayUseCase = new InvokeTask(
      repository,
      new PublishedInvokableRepository(),
      publishedAgentResolver,
    );

    const replay = await replayUseCase.execute({
      idempotencyKey: 'transaction-visible-replay',
      invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
      input: { text: 'transaction visible' },
      accessContext: primaryAccessContext,
    });

    expect(replay.reused).toBe(true);
    expect(first.reused).toBe(false);
    expect(repository.tasksRepository.transactionScopedOwnerReads).toBe(2);
  });

  it('rejects a mismatched workspace_id before admission', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new InvokeTask(
      repository,
      new PublishedInvokableRepository(),
      publishedAgentResolver,
    );

    await expect(
      useCase.execute({
        idempotencyKey: 'workspace-key',
        invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
        input: { text: 'same prompt' },
        workspaceId: 'workspace_other',
        accessContext: primaryAccessContext,
      }),
    ).rejects.toBeInstanceOf(WorkspaceScopeMismatchError);
  });

  it('rejects the same key when the canonical request fingerprint changes', async () => {
    const repository = new InMemoryAdmissionRepository();
    const useCase = new InvokeTask(
      repository,
      new PublishedInvokableRepository(),
      publishedAgentResolver,
      () => new Date('2026-07-22T12:10:00.000Z'),
    );

    await useCase.execute({
      idempotencyKey: 'same-key',
      invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
      input: { text: 'first prompt' },
      accessContext: primaryAccessContext,
    });

    await expect(
      useCase.execute({
        idempotencyKey: 'same-key',
        invokable: { kind: 'agent', versionId: publishedAgentVersion.id },
        input: { text: 'different prompt' },
        accessContext: primaryAccessContext,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});

class PublishedInvokableRepository implements InvokableRepository {

  public async saveTeamDefinition(): Promise<void> {
    throw new Error('Not implemented in invoke-task tests');
  }

  public async findTeamDefinitionById(): Promise<null> {
    return null;
  }

  public async saveTeamVersion(): Promise<void> {
    throw new Error('Not implemented in invoke-task tests');
  }

  public async findTeamVersionById(): Promise<null> {
    return null;
  }

  public async findPublishedTeamVersionById(
    _id: string,
    _ownerScope: {
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly principalType: string;
      readonly principalId: string;
    },
  ): Promise<null> {
    return null;
  }
}

class InMemoryTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, Task>();
  public transactionScopedOwnerReads = 0;

  public constructor(
    private readonly isTransactionActive: () => boolean = () => true,
  ) {}

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
    if (!this.isTransactionActive()) {
      throw new Error(
        'task owner read must occur inside admission transaction',
      );
    }
    this.transactionScopedOwnerReads += 1;
    const task = this.#tasks.get(id);
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
    throw new Error('Not implemented in invoke-task tests');
  }

  public async claimQueuedById(
    _options: ClaimQueuedRunByIdOptions,
  ): Promise<ClaimedRun | null> {
    throw new Error('Not implemented in invoke-task tests');
  }

  public async completeClaimed(
    _options: CompleteClaimedRunOptions,
  ): Promise<Run> {
    throw new Error('Not implemented in invoke-task tests');
  }
}

class InMemoryAdmissionRepository implements AdmissionRepository {
  #transactionActive = false;
  public readonly tasksRepository = new InMemoryTaskRepository(
    () => this.#transactionActive,
  );
  public readonly runsRepository = new InMemoryRunRepository();
  public readonly records: AdmissionRecord[] = [];

  public async withTransaction<T>(
    work: (transaction: AdmissionTransaction) => Promise<T>,
  ): Promise<T> {
    this.#transactionActive = true;
    try {
      return await work({
        tasks: this.tasksRepository,
        runs: this.runsRepository,
        findByIngressAndIdempotencyKey: async (
          ingress,
          idempotencyKey,
          scope,
        ) =>
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
            throw new AdmissionAlreadyExistsError();
          }

          this.records.push(record);
        },
        enqueueRunDispatch: async () => undefined,
      });
    } finally {
      this.#transactionActive = false;
    }
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
