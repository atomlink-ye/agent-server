import type { AccessContext } from '../control-plane/access-context.js';
import type { ExecutionAdmission } from '../ports/execution-admission.js';
import type { WorkIdentityRepository } from '../ports/work-identity-repository.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import {
  PendingWorkRunExpiredError,
  WorkRunBindingConflictError,
} from '../../domain/work/work-run.js';
import {
  WorkIdentityApi,
  WorkDefinitionValidationError,
  type StartPendingWorkRunInput,
} from './work-identity-api.js';

export interface StartWorkRunRequest {
  readonly accessContext: AccessContext;
  /** Retained as a compatibility check; the authenticated context is authoritative. */
  readonly owner?: { readonly tenantId: string; readonly workspaceId: string };
  readonly workId: string;
  readonly triggerKind: 'manual';
  readonly triggerRef?: string;
}

export interface StartWorkRunResult {
  readonly workRun: WorkRun;
  readonly executionReceipt: {
    readonly reused: boolean;
  };
}

export class StartWorkRun {
  public constructor(
    private readonly identity: WorkIdentityApi,
    private readonly repository: WorkIdentityRepository,
    private readonly execution: ExecutionAdmission,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: StartWorkRunRequest): Promise<StartWorkRunResult> {
    const owner = WorkIdentityApi.ownerFromAccessContext(input.accessContext);
    if (
      input.owner &&
      (input.owner.tenantId !== owner.tenantId ||
        input.owner.workspaceId !== owner.workspaceId)
    )
      throw new WorkDefinitionValidationError();
    const pending = await this.identity.startWorkRun({
      owner,
      accessContext: input.accessContext,
      workId: input.workId,
      triggerKind: input.triggerKind,
      ...(input.triggerRef !== undefined
        ? { triggerRef: input.triggerRef }
        : {}),
    } satisfies StartPendingWorkRunInput);

    if (pending.rootTaskId) {
      await this.recordDefinitionManifest(pending, owner);
      return {
        workRun: pending,
        executionReceipt: { reused: true },
      };
    }

    if (new Date(pending.expiresAt).getTime() <= this.now().getTime()) {
      throw new PendingWorkRunExpiredError();
    }

    const receipt = await this.execution.admitRoot({
      invokable: { kind: 'team', versionId: pending.definitionVersionId },
      input: { text: pending.triggerRef },
      workspaceId: owner.workspaceId,
      idempotencyKey: `work-run:${pending.id}`,
      accessContext: input.accessContext,
    });

    try {
      const bound = await this.repository.bindRootTaskCas({
        workRunId: pending.id,
        rootTaskId: receipt.taskId,
        owner,
        now: this.now().toISOString(),
      });
      await this.recordDefinitionManifest(bound, owner);
      return {
        workRun: bound,
        executionReceipt: { reused: receipt.reused },
      };
    } catch (error) {
      if (error instanceof WorkRunBindingConflictError) throw error;
      throw error;
    }
  }

  private async recordDefinitionManifest(
    workRun: WorkRun,
    owner: { readonly tenantId: string; readonly workspaceId: string },
  ): Promise<void> {
    const existing = await this.repository.getResolvedManifest(workRun.id, owner);
    if (existing) {
      const definition = existing.entries.find((entry) => entry.slot === 'definition');
      if (
        existing.entries.length === 1 &&
        definition?.resourceKind === 'definition' &&
        definition.resolvedVersionId === workRun.definitionVersionId &&
        definition.requestedRef === null
      )
        return;
      throw new Error('The WorkRun resolved manifest conflicts with its pinned definition.');
    }
    const input = {
      workRunId: workRun.id,
      owner,
      entries: [
        {
          slot: 'definition',
          resourceKind: 'definition',
          requestedRef: null,
          resolvedVersionId: workRun.definitionVersionId,
          resolvedFingerprint: null,
          resolvedAt: this.now().toISOString(),
        },
      ],
    } as const;
    if (this.repository.recordResolvedManifest)
      await this.repository.recordResolvedManifest(input);
    else await this.repository.appendResolvedManifest(input);
  }
}
