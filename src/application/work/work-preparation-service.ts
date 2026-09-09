import { createHash } from 'node:crypto';
import type { AccessContext } from '../../domain/access-context.js';
import type { WorkInputSchema } from '../../domain/work/work-input-schema.js';
import type { WorkPreparation } from '../../domain/work/work-preparation.js';
import type { WorkPreparationRepository } from '../ports/work-preparation-repository.js';
import type { WorkIdentityApi } from './work-identity-api.js';
import {
  validateProductWorkRunInput,
  type ProductWorkInputSchema,
} from './validate-product-work-definition.js';
import type { StartWorkRun } from './start-work-run.js';

export interface WorkPreparationServiceOptions {
  readonly repository: WorkPreparationRepository;
  readonly identity: Pick<WorkIdentityApi, 'findWorkById'>;
  readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
  readonly schemaForVersion: (input: {
    readonly versionId: string;
    readonly accessContext: AccessContext;
  }) => Promise<{ readonly schema: ProductWorkInputSchema } | null>;
  readonly now?: () => Date;
}

export class WorkPreparationVersionMismatchError extends Error {
  public readonly code = 'work_preparation_version_mismatch';
  public constructor() {
    super(
      'The Work Definition changed. Prepare the Work again before starting.',
    );
    this.name = 'WorkPreparationVersionMismatchError';
  }
}

export class WorkPreparationNotReadyError extends Error {
  public readonly code = 'work_preparation_not_ready';
  public constructor() {
    super('The Work preparation is not ready to start.');
    this.name = 'WorkPreparationNotReadyError';
  }
}

export class WorkPreparationRevisionMismatchError extends Error {
  public readonly code = 'work_preparation_revision_mismatch';
  public constructor() {
    super('The Work preparation changed. Refresh it before confirming.');
    this.name = 'WorkPreparationRevisionMismatchError';
  }
}

export class WorkPreparationService {
  private readonly now: () => Date;
  public constructor(private readonly options: WorkPreparationServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public get(input: {
    owner: { tenantId: string; workspaceId: string };
    workId: string;
  }) {
    return this.options.repository.findCurrent(input);
  }

  public async getIntakeContext(input: {
    readonly owner: { tenantId: string; workspaceId: string };
    readonly workId: string;
    readonly accessContext: AccessContext;
  }): Promise<{
    readonly definitionVersionId: string;
    readonly schema: ProductWorkInputSchema;
  } | null> {
    const work = await this.options.identity.findWorkById(
      input.workId,
      input.owner,
    );
    if (!work) return null;
    const contract = await this.options.schemaForVersion({
      versionId: work.currentDefinitionVersionId,
      accessContext: input.accessContext,
    });
    return contract
      ? {
          definitionVersionId: work.currentDefinitionVersionId,
          schema: contract.schema,
        }
      : null;
  }

  public async observeLead(input: {
    readonly owner: { tenantId: string; workspaceId: string };
    readonly workId: string;
    readonly accessContext: AccessContext;
    readonly candidateInput: Readonly<Record<string, unknown>>;
    readonly missing?: readonly string[];
    readonly ambiguities?: readonly string[];
    readonly sourceMessageId?: string;
  }): Promise<WorkPreparation> {
    const work = await this.options.identity.findWorkById(
      input.workId,
      input.owner,
    );
    if (!work) throw new Error('work_not_found');
    const contract = await this.options.schemaForVersion({
      versionId: work.currentDefinitionVersionId,
      accessContext: input.accessContext,
    });
    const schema =
      contract?.schema ??
      ({
        type: 'object',
        properties: {},
        required: [],
        additional_properties: false,
      } as WorkInputSchema);
    const validation = validateProductWorkRunInput(
      schema,
      input.candidateInput,
    );
    const schemaMissing = validation.valid
      ? []
      : validation.diagnostics
          .filter(
            (item) =>
              item.path.startsWith('$.input.') &&
              item.message === 'is required',
          )
          .map((item) => item.path.slice('$.input.'.length));
    const missing = [...new Set([...schemaMissing, ...(input.missing ?? [])])];
    const status =
      contract &&
      validation.valid &&
      missing.length === 0 &&
      !input.ambiguities?.length
        ? 'ready'
        : 'collecting';
    return this.options.repository.upsert({
      owner: input.owner,
      workId: input.workId,
      definitionVersionId: work.currentDefinitionVersionId,
      schemaFingerprint: schemaFingerprint(schema),
      candidateInput: validation.valid
        ? validation.input
        : input.candidateInput,
      missing,
      ambiguities: input.ambiguities ?? [],
      status,
      now: this.now().toISOString(),
      ...(input.sourceMessageId
        ? { sourceMessageId: input.sourceMessageId }
        : {}),
    });
  }

  public async confirm(input: {
    readonly owner: { tenantId: string; workspaceId: string };
    readonly accessContext: AccessContext;
    readonly workId: string;
    readonly preparationId: string;
    readonly expectedRevision?: number;
  }) {
    const preparation = await this.options.repository.findCurrent(input);
    if (!preparation || preparation.id !== input.preparationId)
      throw new WorkPreparationNotReadyError();
    if (
      input.expectedRevision !== undefined &&
      preparation.revision !== input.expectedRevision
    )
      throw new WorkPreparationRevisionMismatchError();
    if (
      this.options.repository.hasPendingUserMessages &&
      (await this.options.repository.hasPendingUserMessages(input))
    )
      throw new WorkPreparationRevisionMismatchError();
    const work = await this.options.identity.findWorkById(
      input.workId,
      input.owner,
    );
    if (!work) throw new Error('work_not_found');
    if (work.currentDefinitionVersionId !== preparation.definitionVersionId)
      throw new WorkPreparationVersionMismatchError();
    if (preparation.workRunId)
      return { preparation, workRunId: preparation.workRunId, reused: true };
    if (preparation.status !== 'ready' && preparation.status !== 'starting')
      throw new WorkPreparationNotReadyError();
    const validated = await this.options.schemaForVersion({
      versionId: preparation.definitionVersionId,
      accessContext: input.accessContext,
    });
    if (!validated) throw new WorkPreparationNotReadyError();
    const schema = validated.schema;
    const check = validateProductWorkRunInput(
      schema,
      preparation.candidateInput,
    );
    if (!check.valid) throw new WorkPreparationNotReadyError();
    const fingerprint = check.fingerprint;
    const startIntent = `work-preparation:${preparation.id}`;
    const claimed = await this.options.repository.beginConfirmation({
      owner: input.owner,
      preparationId: preparation.id,
      fingerprint,
      startIntent,
      workId: input.workId,
      expectedRevision: preparation.revision,
      now: this.now().toISOString(),
    });
    if (!claimed) throw new WorkPreparationNotReadyError();
    if (claimed.workRunId)
      return {
        preparation: claimed,
        workRunId: claimed.workRunId,
        reused: true,
      };
    let started: Awaited<ReturnType<StartWorkRun['execute']>>;
    try {
      started = await this.options.startWorkRun.execute({
        accessContext: input.accessContext,
        workId: input.workId,
        triggerKind: 'manual',
        triggerRef: startIntent,
        expectedDefinitionVersionId: preparation.definitionVersionId,
        input: check.input,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (('code' in error &&
          (error as { readonly code?: string }).code ===
            'work_definition_version_mismatch') ||
          error.message === 'The Work Definition changed before admission.')
      )
        throw new WorkPreparationVersionMismatchError();
      throw error;
    }
    const associated = await this.options.repository.associateRun({
      owner: input.owner,
      preparationId: preparation.id,
      workRunId: started.workRun.id,
      now: this.now().toISOString(),
    });
    return {
      preparation: associated,
      workRun: started.workRun,
      reused: started.executionReceipt.reused,
    };
  }
}

export function schemaFingerprint(schema: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(schema)).digest('hex')}`;
}
