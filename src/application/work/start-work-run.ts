import type { AccessContext } from '../../platform/access-context.js';
import type { ExecutionAdmission } from '../ports/execution-admission.js';
import type {
  ExecutionPlaneCapabilities,
  ExecutionPlaneCapability,
} from '../ports/execution-plane.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import {
  PendingWorkRunExpiredError,
  WorkRunBindingConflictError,
} from '../../domain/work/work-run.js';
import {
  manifestEntriesForResolvedWorkDefinition,
  type ResolvedWorkDefinition,
  type RequiredRuntimeCapability,
} from '../../domain/work/work-composition.js';
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
  readonly runtimeCapabilities?: {
    capabilities(): ExecutionPlaneCapabilities;
  };
  readonly now?: () => Date;
}

const NO_RUNTIME_CAPABILITIES = Object.freeze({
  capabilities(): ExecutionPlaneCapabilities {
    return { supported: new Set() };
  },
});

export class StartWorkRun {
  private readonly identity: WorkIdentityApi;
  private readonly execution: ExecutionAdmission;
  private readonly runtimeCapabilities: NonNullable<
    StartWorkRunOptions['runtimeCapabilities']
  >;
  private readonly now: () => Date;

  public constructor(options: StartWorkRunOptions) {
    this.identity = options.identity;
    this.execution = options.execution;
    this.runtimeCapabilities =
      options.runtimeCapabilities ?? NO_RUNTIME_CAPABILITIES;
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

    // Resolve and check capabilities before the technical Task can reach the
    // Execution Plane. No provider/runtime side effect is allowed on failure.
    const resolved = await this.identity.resolveCurrentDefinition({
      owner,
      accessContext: input.accessContext,
      workId: input.workId,
    });
    this.assertRuntimeCapabilities(resolved);

    const pending = await this.identity.startWorkRun({
      owner,
      accessContext: input.accessContext,
      workId: input.workId,
      triggerKind: input.triggerKind,
      ...(input.triggerRef !== undefined
        ? { triggerRef: input.triggerRef }
        : {}),
    } satisfies StartPendingWorkRunInput);
    if (pending.definitionVersionId !== resolved.definitionVersionId)
      throw new WorkDefinitionValidationError();

    if (pending.rootTaskId) {
      await this.recordResolvedManifest(pending, owner, resolved);
      return {
        workRun: pending,
        executionReceipt: { reused: true, taskId: pending.rootTaskId },
      };
    }

    if (new Date(pending.expiresAt).getTime() <= this.now().getTime())
      throw new PendingWorkRunExpiredError();

    // The immutable composition becomes a durable WorkRun fact before Task
    // admission, so a queued provider turn can never observe registry-latest
    // drift without a pinned manifest already existing.
    await this.recordResolvedManifest(pending, owner, resolved);

    const receipt = await this.execution.admitRoot({
      invokable: resolved.executionPolicy.invokable,
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
      // The current durable repository permits a manifest only after root Task
      // binding. The Task itself is admitted from the already-resolved immutable
      // definition, and retries converge on this exact manifest.
      await this.recordResolvedManifest(bound, owner, resolved);
      return {
        workRun: bound,
        executionReceipt: { reused: receipt.reused, taskId: receipt.taskId },
      };
    } catch (error) {
      if (error instanceof WorkRunBindingConflictError) throw error;
      throw error;
    }
  }

  private assertRuntimeCapabilities(definition: ResolvedWorkDefinition): void {
    const supported = this.runtimeCapabilities.capabilities().supported;
    for (const required of definition.executionPolicy
      .requiredRuntimeCapabilities) {
      if (!supported.has(asExecutionPlaneCapability(required)))
        throw new UnsupportedWorkCompositionCapabilityError(required);
    }
  }

  private async recordResolvedManifest(
    workRun: WorkRun,
    owner: { readonly tenantId: string; readonly workspaceId: string },
    definition: ResolvedWorkDefinition,
  ): Promise<void> {
    const entries = manifestEntriesForResolvedWorkDefinition(
      definition,
      workRun.createdAt,
    );
    const existing = await this.identity.getResolvedManifest(workRun.id, owner);
    if (existing) {
      if (manifestEquivalent(existing.entries, entries)) return;
      throw new Error(
        'The WorkRun resolved manifest conflicts with its pinned composition.',
      );
    }
    await this.identity.recordResolvedManifest({
      workRunId: workRun.id,
      owner,
      entries,
    });
  }
}

export class UnsupportedWorkCompositionCapabilityError extends Error {
  public readonly code = 'unsupported_runtime_capability';

  public constructor(public readonly capability: RequiredRuntimeCapability) {
    super(`The Work requires unsupported runtime capability: ${capability}.`);
    this.name = 'UnsupportedWorkCompositionCapabilityError';
  }
}

function asExecutionPlaneCapability(
  capability: RequiredRuntimeCapability,
): ExecutionPlaneCapability {
  return capability;
}

function manifestEquivalent(
  left: readonly {
    readonly slot: string;
    readonly resourceKind: string;
    readonly requestedRef: string | null;
    readonly resolvedVersionId: string;
    readonly resolvedFingerprint: string | null;
    readonly resolvedAt: string;
  }[],
  right: readonly {
    readonly slot: string;
    readonly resourceKind: string;
    readonly requestedRef: string | null;
    readonly resolvedVersionId: string;
    readonly resolvedFingerprint: string | null;
    readonly resolvedAt: string;
  }[],
): boolean {
  const order = (entries: typeof left) =>
    [...entries].sort((a, b) => a.slot.localeCompare(b.slot));
  const a = order(left);
  const b = order(right);
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index]!;
      return (
        entry.slot === other.slot &&
        entry.resourceKind === other.resourceKind &&
        entry.requestedRef === other.requestedRef &&
        entry.resolvedVersionId === other.resolvedVersionId &&
        entry.resolvedFingerprint === other.resolvedFingerprint &&
        entry.resolvedAt === other.resolvedAt
      );
    })
  );
}
