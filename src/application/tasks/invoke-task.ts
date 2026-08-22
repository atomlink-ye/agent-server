import { createHash, randomUUID } from 'node:crypto';

import type { AccessContext } from '../../platform/access-context.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import type {
  AdmissionOwnerScope,
  AdmissionRepository,
  AdmissionTransaction,
} from '../ports/admission-repository.js';
import { AdmissionAlreadyExistsError } from '../ports/admission-repository.js';
import type { InvokableOwnerScope } from '../ports/invokable-repository.js';
import type { DefinitionReadApi } from '../ports/definition-read-api.js';
import type {
  TaskOwnerScope,
  TaskRecord,
  TaskRepository,
} from '../ports/task-repository.js';
import { createRun } from '../../domain/runs/run.js';
import { createRootTask } from '../../domain/tasks/task.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

export interface InvokeTaskRequest {
  readonly invokable: {
    readonly kind: 'agent' | 'team';
    readonly versionId: string;
  };
  readonly input: {
    readonly text: string;
  };
  readonly workspaceId?: string;
  readonly idempotencyKey?: string;
  readonly accessContext: AccessContext;
}

export interface InvokeTaskResult {
  readonly task: TaskRecord;
  readonly reused: boolean;
}

export class InvokeTask {
  public constructor(
    private readonly admissions: AdmissionRepository,
    private readonly definitions: DefinitionReadApi,
    private readonly resolver: AgentResolutionApi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(request: InvokeTaskRequest): Promise<InvokeTaskResult> {
    const resolvedWorkspaceId = resolveWorkspaceId(
      request.workspaceId,
      request.accessContext,
    );
    const normalizedInput = normalizeRootTaskRunRequest({
      prompt: request.input.text,
    });
    const fingerprint = fingerprintInvokeTaskRequest({
      invokableKind: request.invokable.kind,
      invokableVersionId: request.invokable.versionId,
      workspaceId: resolvedWorkspaceId,
      inputText: normalizedInput.prompt,
    });
    const idempotencyKey = request.idempotencyKey ?? randomUUID();

    try {
      return await this.admissions.withTransaction(async (transaction) => {
        const existing = await this.findAcceptedInTransaction(
          transaction,
          idempotencyKey,
          fingerprint,
          request.accessContext,
        );

        if (existing) return existing;

        await this.assertPublishedInvokableExists(request);

        const admittedAt = this.now();
        const frozenNow = () => admittedAt;
        const task = createRootTask({
          tenantId: request.accessContext.tenantId,
          workspaceId: resolvedWorkspaceId,
          principalType: request.accessContext.principalType,
          principalId: request.accessContext.principalId,
          policySnapshotVersion: request.accessContext.policySnapshotVersion,
          ingress: 'api',
          originRef: null,
          invokableKind: request.invokable.kind,
          invokableVersionId: request.invokable.versionId,
          inputSnapshotRef:
            encodeRootTaskRunRequestSnapshotRef(normalizedInput),
          inputFingerprint: fingerprint,
          now: frozenNow,
        });
        const run = createRun(normalizedInput.prompt, { now: frozenNow });

        await transaction.tasks.save(task);
        await transaction.runs.save(run, { taskId: task.id, attempt: 1 });
        await transaction.save({
          ingress: 'api',
          originRef: null,
          idempotencyKey,
          requestFingerprint: fingerprint,
          taskId: task.id,
          tenantId: request.accessContext.tenantId,
          workspaceId: resolvedWorkspaceId,
          principalType: request.accessContext.principalType,
          principalId: request.accessContext.principalId,
          policySnapshotVersion: request.accessContext.policySnapshotVersion,
          createdAt: task.createdAt,
        });
        await transaction.enqueueRunDispatch(run.id, run.createdAt);

        return {
          task: await this.loadTask(
            transaction.tasks,
            task.id,
            request.accessContext,
          ),
          reused: false,
        };
      });
    } catch (error) {
      if (error instanceof AdmissionAlreadyExistsError) {
        const recovered = await this.admissions.withTransaction((transaction) =>
          this.findAcceptedInTransaction(
            transaction,
            idempotencyKey,
            fingerprint,
            request.accessContext,
          ),
        );
        if (recovered) return recovered;
        throw new Error(
          'Admission conflict recovery could not reload the task',
        );
      }
      throw error;
    }
  }

  private async findAcceptedInTransaction(
    transaction: AdmissionTransaction,
    idempotencyKey: string,
    fingerprint: string,
    accessContext: AccessContext,
  ): Promise<InvokeTaskResult | null> {
    const existing = await transaction.findByIngressAndIdempotencyKey(
      'api',
      idempotencyKey,
      toAdmissionOwnerScope(accessContext),
    );
    if (!existing) return null;
    if (existing.requestFingerprint !== fingerprint)
      throw new IdempotencyConflictError();
    return {
      task: await this.loadTask(
        transaction.tasks,
        existing.taskId,
        accessContext,
      ),
      reused: true,
    };
  }

  private async loadTask(
    repository: TaskRepository,
    taskId: string,
    accessContext: AccessContext,
  ): Promise<TaskRecord> {
    const task = await repository.findByIdForOwner(
      taskId,
      toTaskOwnerScope(accessContext),
    );
    if (!task) throw new Error('Admitted task could not be reloaded');
    return task;
  }

  private async assertPublishedInvokableExists(
    request: InvokeTaskRequest,
  ): Promise<void> {
    const version =
      request.invokable.kind === 'agent'
        ? await this.resolver.resolvePublished(
            request.invokable.versionId,
            toInvokableOwnerScope(request.accessContext),
          )
        : await this.definitions.findPublishedTeamVersionById(
            request.invokable.versionId,
            toInvokableOwnerScope(request.accessContext),
          );
    if (!version) throw new InvokableNotFoundError();
  }
}

export class InvokableNotFoundError extends Error {
  public readonly code = 'invokable_not_found';
  public constructor() {
    super('The requested published invokable does not exist.');
    this.name = 'InvokableNotFoundError';
  }
}

export class WorkspaceScopeMismatchError extends Error {
  public readonly code = 'workspace_scope_mismatch';
  public constructor() {
    super('The requested workspace_id must match the authenticated workspace.');
    this.name = 'WorkspaceScopeMismatchError';
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

function resolveWorkspaceId(
  workspaceId: string | undefined,
  accessContext: AccessContext,
): string {
  if (workspaceId === undefined) return accessContext.workspaceId;
  if (workspaceId !== accessContext.workspaceId)
    throw new WorkspaceScopeMismatchError();
  return workspaceId;
}

function fingerprintInvokeTaskRequest(input: {
  readonly invokableKind: 'agent' | 'team';
  readonly invokableVersionId: string;
  readonly workspaceId: string;
  readonly inputText: string;
}): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')}`;
}

function toTaskOwnerScope(accessContext: AccessContext): TaskOwnerScope {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}

function toAdmissionOwnerScope(
  accessContext: AccessContext,
): AdmissionOwnerScope {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}

function toInvokableOwnerScope(
  accessContext: AccessContext,
): InvokableOwnerScope {
  return {
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}
