import type { AccessContext } from '../../platform/access-context.js';
import { createRun } from '../../domain/runs/run.js';
import { createRootTask } from '../../domain/tasks/task.js';
import {
  AdmissionAlreadyExistsError,
  type AdmissionRepository,
  type AdmissionTransaction,
} from '../ports/admission-repository.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

export interface AdmitRootTaskRequest {
  readonly prompt: string;
  readonly idempotencyKey: string;
  readonly accessContext: AccessContext;
}

export interface AdmitRootTaskResult {
  readonly taskId: string;
  readonly runId: string;
  readonly reused: boolean;
}

export class AdmitRootTask {
  public constructor(
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly admissions: AdmissionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async findAccepted(
    request: AdmitRootTaskRequest,
  ): Promise<AdmitRootTaskResult | null> {
    const normalized = normalizeRootTaskRunRequest({ prompt: request.prompt });
    const fingerprint = fingerprintRootTaskRunRequest(normalized);

    return this.admissions.withTransaction(async (transaction) =>
      this.findAcceptedInTransaction(
        transaction,
        request.idempotencyKey,
        fingerprint,
        request.accessContext,
      ),
    );
  }

  public async execute(
    request: AdmitRootTaskRequest,
  ): Promise<AdmitRootTaskResult> {
    const normalized = normalizeRootTaskRunRequest({ prompt: request.prompt });
    const fingerprint = fingerprintRootTaskRunRequest(normalized);

    try {
      return await this.admissions.withTransaction(async (transaction) => {
        const existing = await this.findAcceptedInTransaction(
          transaction,
          request.idempotencyKey,
          fingerprint,
          request.accessContext,
        );

        if (existing) {
          return existing;
        }

        const admittedAt = this.now();
        const frozenNow = () => admittedAt;
        const task = createRootTask({
          tenantId: request.accessContext.tenantId,
          workspaceId: request.accessContext.workspaceId,
          principalType: request.accessContext.principalType,
          principalId: request.accessContext.principalId,
          policySnapshotVersion: request.accessContext.policySnapshotVersion,
          ingress: 'api',
          originRef: null,
          invokableKind: 'agent',
          invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
          inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef(normalized),
          inputFingerprint: fingerprint,
          now: frozenNow,
        });
        const run = createRun(normalized.prompt, { now: frozenNow });

        await transaction.tasks.save(task);
        await transaction.runs.save(run, { taskId: task.id, attempt: 1 });
        await transaction.save({
          ingress: 'api',
          originRef: null,
          idempotencyKey: request.idempotencyKey,
          requestFingerprint: fingerprint,
          taskId: task.id,
          tenantId: request.accessContext.tenantId,
          workspaceId: request.accessContext.workspaceId,
          principalType: request.accessContext.principalType,
          principalId: request.accessContext.principalId,
          policySnapshotVersion: request.accessContext.policySnapshotVersion,
          createdAt: task.createdAt,
        });
        await transaction.enqueueRunDispatch(run.id, run.createdAt);

        return {
          taskId: task.id,
          runId: run.id,
          reused: false,
        };
      });
    } catch (error) {
      if (error instanceof AdmissionAlreadyExistsError) {
        const recovered = await this.findAccepted(request);

        if (recovered) {
          return recovered;
        }

        throw new Error('Admission conflict recovery could not reload the run');
      }

      throw error;
    }
  }

  private async findAcceptedInTransaction(
    transaction: AdmissionTransaction,
    idempotencyKey: string,
    fingerprint: string,
    accessContext: AccessContext,
  ): Promise<AdmitRootTaskResult | null> {
    const existing = await transaction.findByIngressAndIdempotencyKey(
      'api',
      idempotencyKey,
      {
        tenantId: accessContext.tenantId,
        workspaceId: accessContext.workspaceId,
        principalType: accessContext.principalType,
        principalId: accessContext.principalId,
      },
    );

    if (!existing) {
      return null;
    }

    if (existing.requestFingerprint !== fingerprint) {
      throw new IdempotencyConflictError();
    }

    const existingRun = await transaction.runs.findByTaskId(existing.taskId);
    if (!existingRun) {
      throw new Error('Admission points to a missing run');
    }

    return {
      taskId: existing.taskId,
      runId: existingRun.id,
      reused: true,
    };
  }
}

export class IdempotencyConflictError extends Error {
  public readonly code = 'idempotency_conflict';

  public constructor() {
    super(
      'The Idempotency-Key cannot be reused with a different request body.',
    );
    this.name = 'IdempotencyConflictError';
  }
}
