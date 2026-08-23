import type { AccessContext } from '../../domain/access-context.js';
import type { ExecutionPlaneCapability } from '../ports/execution-plane.js';
import type { ExecutionAdmission } from '../ports/execution-admission.js';
import type { RuntimeCapabilities } from '../runtime/runtime-capabilities.js';
import type { WorkRunInputStore } from '../ports/work-run-input-store.js';
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
import { canonicalizeProjectValue } from '../../domain/projects/project-canonicalization.js';
import type { ProductWorkDefinitionApi } from './product-work-definition-api.js';
import {
  validateProductWorkRunInput,
  type WorkDefinitionDiagnostic,
} from './validate-product-work-definition.js';
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
  readonly predecessorWorkRunId?: string;
  /** Product-authored Work Definitions may declare a bounded object input contract. */
  readonly input?: Readonly<Record<string, unknown>>;
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
  readonly runtimeCapabilities: RuntimeCapabilities;
  readonly productDefinitions?: Pick<
    ProductWorkDefinitionApi,
    'getInputContract'
  >;
  readonly workRunInputs?: WorkRunInputStore;
  readonly now?: () => Date;
}

export class StartWorkRun {
  private readonly identity: WorkIdentityApi;
  private readonly execution: ExecutionAdmission;
  private readonly runtimeCapabilities: RuntimeCapabilities;
  private readonly productDefinitions?: StartWorkRunOptions['productDefinitions'];
  private readonly workRunInputs: WorkRunInputStore | undefined;
  private readonly now: () => Date;

  public constructor(options: StartWorkRunOptions) {
    this.identity = options.identity;
    this.execution = options.execution;
    this.runtimeCapabilities = options.runtimeCapabilities;
    this.productDefinitions = options.productDefinitions;
    this.workRunInputs = options.workRunInputs;
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

    if (input.predecessorWorkRunId) {
      const predecessor = await this.identity.getWorkRun(
        input.predecessorWorkRunId,
        owner,
      );
      if (!predecessor || predecessor.workId !== input.workId)
        throw new WorkDefinitionValidationError();
    }

    const resolved = await this.identity.resolveCurrentDefinition({
      owner,
      accessContext: input.accessContext,
      workId: input.workId,
    });
    this.assertRuntimeCapabilities(resolved);
    const preparedInput = await this.prepareProductInput(
      resolved,
      input.input,
      input.accessContext,
    );

    const pending = await this.identity.startWorkRun({
      owner,
      accessContext: input.accessContext,
      workId: input.workId,
      triggerKind: input.triggerKind,
      ...(input.triggerRef !== undefined
        ? { triggerRef: input.triggerRef }
        : {}),
      ...(input.predecessorWorkRunId !== undefined
        ? { predecessorWorkRunId: input.predecessorWorkRunId }
        : {}),
    } satisfies StartPendingWorkRunInput);
    if (pending.definitionVersionId !== resolved.definitionVersionId)
      throw new WorkDefinitionValidationError();

    if (preparedInput) {
      if (!this.workRunInputs)
        throw new Error('Product WorkRun input persistence is unavailable.');
      await this.workRunInputs.record({
        workRunId: pending.id,
        owner,
        snapshot: preparedInput.snapshot,
        fingerprint: preparedInput.fingerprint,
      });
    }

    if (pending.rootTaskId) {
      await this.recordResolvedManifest(pending, owner, resolved);
      return {
        workRun: pending,
        executionReceipt: { reused: true, taskId: pending.rootTaskId },
      };
    }

    if (new Date(pending.expiresAt).getTime() <= this.now().getTime())
      throw new PendingWorkRunExpiredError();

    await this.recordResolvedManifest(pending, owner, resolved);

    const receipt = await this.execution.admitRoot({
      invokable: resolved.executionPolicy.invokable,
      input: {
        text: preparedInput?.executionText ?? pending.triggerRef,
      },
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
      return {
        workRun: bound,
        executionReceipt: { reused: receipt.reused, taskId: receipt.taskId },
      };
    } catch (error) {
      if (error instanceof WorkRunBindingConflictError) throw error;
      throw error;
    }
  }

  private async prepareProductInput(
    definition: ResolvedWorkDefinition,
    input: Readonly<Record<string, unknown>> | undefined,
    accessContext: AccessContext,
  ): Promise<{
    readonly snapshot: Readonly<Record<string, unknown>>;
    readonly fingerprint: string;
    readonly executionText: string;
  } | null> {
    const contract = this.productDefinitions
      ? await this.productDefinitions.getInputContract({
          versionId: definition.definitionVersionId,
          accessContext,
        })
      : null;
    if (!contract) {
      if (input !== undefined)
        throw new WorkRunInputValidationError([
          {
            path: '$.input',
            code: 'input_validation_failed',
            message:
              'Typed input is only available for Product-authored Work Definitions.',
            severity: 'error',
          },
        ]);
      return null;
    }
    const validated = validateProductWorkRunInput(contract.schema, input ?? {});
    if (!validated.valid)
      throw new WorkRunInputValidationError(validated.diagnostics);
    return {
      snapshot: validated.input,
      fingerprint: validated.fingerprint,
      executionText: renderExecutionInput({
        name: contract.name,
        description: contract.description,
        input: validated.input,
      }),
    };
  }

  private assertRuntimeCapabilities(definition: ResolvedWorkDefinition): void {
    const supported = this.runtimeCapabilities.supported;
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

export class WorkRunInputValidationError extends Error {
  public readonly code = 'input_validation_failed';
  public constructor(
    public readonly diagnostics: readonly WorkDefinitionDiagnostic[],
  ) {
    super('The WorkRun input does not match the Work Definition input schema.');
    this.name = 'WorkRunInputValidationError';
  }
}

export class UnsupportedWorkCompositionCapabilityError extends Error {
  public readonly code = 'unsupported_runtime_capability';

  public constructor(public readonly capability: RequiredRuntimeCapability) {
    super(`The Work requires unsupported runtime capability: ${capability}.`);
    this.name = 'UnsupportedWorkCompositionCapabilityError';
  }
}

function renderExecutionInput(input: {
  readonly name: string;
  readonly description: string | null;
  readonly input: Readonly<Record<string, unknown>>;
}): string {
  return [
    `Work: ${input.name}`,
    ...(input.description ? [`Objective: ${input.description}`] : []),
    'Input:',
    canonicalizeProjectValue(input.input),
  ].join('\n');
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
