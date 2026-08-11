import type { AccessContext } from '../control-plane/access-context.js';
import type { ExecutionAdmission } from '../ports/execution-admission.js';
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
    /** Technical Task identity retained for the receipt boundary only. */
    readonly taskId: string;
  };
}

export interface StartWorkRunOptions {
  readonly identity: WorkIdentityApi;
  readonly execution: ExecutionAdmission;
  readonly now?: () => Date;
}

export class StartWorkRun {
  private readonly identity: WorkIdentityApi;
  private readonly execution: ExecutionAdmission;
  private readonly now: () => Date;

  public constructor(options: StartWorkRunOptions) {
    this.identity = options.identity;
    this.execution = options.execution;
    this.now = options.now ?? (() => new Date());
  }

  public async execute(
    input: StartWorkRunRequest,
  ): Promise<StartWorkRunResult> {
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
        executionReceipt: { reused: true, taskId: pending.rootTaskId },
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
      const bound = await this.identity.bindRootTaskCas({
        workRunId: pending.id,
        rootTaskId: receipt.taskId,
        owner,
        now: this.now().toISOString(),
      });
      await this.recordDefinitionManifest(bound, owner);
      return {
        workRun: bound,
        executionReceipt: { reused: receipt.reused, taskId: receipt.taskId },
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
    const requestedRef = `team_version:${workRun.definitionVersionId}`;
    const existing = await this.identity.getResolvedManifest(workRun.id, owner);
    if (existing) {
      const definition = existing.entries.find(
        (entry) => entry.slot === 'definition',
      );
      if (
        existing.entries.length === 1 &&
        definition?.resourceKind === 'definition' &&
        definition.resolvedVersionId === workRun.definitionVersionId &&
        definition.requestedRef === requestedRef
      )
        return;
      throw new Error(
        'The WorkRun resolved manifest conflicts with its pinned definition.',
      );
    }
    const input = {
      workRunId: workRun.id,
      owner,
      entries: [
        {
          slot: 'definition',
          resourceKind: 'definition',
          requestedRef,
          resolvedVersionId: workRun.definitionVersionId,
          resolvedFingerprint: null,
          resolvedAt: this.now().toISOString(),
        },
      ],
    } as const;
    await this.identity.recordResolvedManifest(input);
  }
}
