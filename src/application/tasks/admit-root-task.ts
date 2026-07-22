import { createRun } from '../../domain/runs/run.js';
import { createRootTask } from '../../domain/tasks/task.js';
import {
  AdmissionAlreadyExistsError,
  type AdmissionRepository,
  type AdmissionTransaction,
} from '../ports/admission-repository.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

export interface AdmitRootTaskRequest {
  readonly prompt: string;
  readonly idempotencyKey: string;
}

export interface AdmitRootTaskResult {
  readonly taskId: string;
  readonly runId: string;
  readonly reused: boolean;
}

const BASELINE_RUN_API_INVOKABLE_VERSION_ID = 'baseline-run-api';

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
        );

        if (existing) {
          return existing;
        }

        const admittedAt = this.now();
        const frozenNow = () => admittedAt;
        const task = createRootTask({
          ingress: 'api',
          invokableKind: 'agent',
          invokableVersionId: BASELINE_RUN_API_INVOKABLE_VERSION_ID,
          inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef(normalized),
          inputFingerprint: fingerprint,
          now: frozenNow,
        });
        const run = createRun(normalized.prompt, { now: frozenNow });

        await transaction.tasks.save(task);
        await transaction.runs.save(run, { taskId: task.id, attempt: 1 });
        await transaction.save({
          ingress: 'api',
          idempotencyKey: request.idempotencyKey,
          requestFingerprint: fingerprint,
          taskId: task.id,
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
  ): Promise<AdmitRootTaskResult | null> {
    const existing = await transaction.findByIngressAndIdempotencyKey(
      'api',
      idempotencyKey,
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
