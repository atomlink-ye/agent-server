import { createHash, randomUUID } from 'node:crypto';

import type { AccessContext } from '../control-plane/access-context.js';
import type { TeamDefinition } from '../../domain/invokables/team-definition.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';
import type { WorkDefinitionReadPort } from '../ports/work-definition-read.js';
import type {
  BindRootTaskCasInput,
  WorkIdentityRepository,
  WorkIdentityOwnerScope,
  WorkIdentityListQuery,
  WorkListPage,
  WorkRunListPage,
} from '../ports/work-identity-repository.js';
import { InvalidWorkListCursorError } from '../ports/work-identity-repository.js';
import { createWork, WorkNotFoundError } from '../../domain/work/work.js';
import type { Work } from '../../domain/work/work.js';
import type { BoundWorkRun, WorkRun } from '../../domain/work/work-run.js';
import type {
  RecordResolvedManifestInput,
  ResolvedResourceManifest,
} from '../../domain/work/resolved-resource-manifest.js';

export interface CreateWorkInput {
  readonly owner: WorkIdentityOwnerScope;
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly title: string;
  readonly accessContext: AccessContext;
}

export interface StartPendingWorkRunInput {
  readonly owner: WorkIdentityOwnerScope;
  readonly workId: string;
  readonly triggerKind: 'manual';
  readonly triggerRef?: string;
  readonly accessContext: AccessContext;
}

export interface WorkIdentityApiOptions {
  readonly repository: WorkIdentityRepository;
  readonly definitions: WorkDefinitionReadPort;
  readonly now?: () => Date;
  readonly pendingTtlMs?: number;
}

export interface UpdateWorkDefinitionVersionInput {
  readonly owner: WorkIdentityOwnerScope;
  readonly accessContext: AccessContext;
  readonly workId: string;
  readonly definitionVersionId: string;
}
export interface ListWorksInput extends WorkIdentityListQuery {
  readonly owner: WorkIdentityOwnerScope;
  readonly accessContext: AccessContext;
}
export interface ListWorkRunsInput extends WorkIdentityListQuery {
  readonly owner: WorkIdentityOwnerScope;
  readonly accessContext: AccessContext;
  readonly workId: string;
}

export interface GetWorkDefinitionInput {
  readonly owner: WorkIdentityOwnerScope;
  readonly accessContext: AccessContext;
  readonly workId: string;
}

export interface WorkDefinitionBinding {
  readonly definition: TeamDefinition;
  readonly version: TeamVersion;
}

export class WorkIdentityApi {
  private readonly now: () => Date;
  private readonly pendingTtlMs: number;

  public constructor(options: WorkIdentityApiOptions) {
    this.repository = options.repository;
    this.definitions = options.definitions;
    this.now = options.now ?? (() => new Date());
    this.pendingTtlMs = options.pendingTtlMs ?? 15 * 60 * 1000;
  }

  private readonly repository: WorkIdentityRepository;
  private readonly definitions: WorkDefinitionReadPort;

  public async createWork(input: CreateWorkInput): Promise<Work> {
    const accessOwner = WorkIdentityApi.ownerFromAccessContext(
      input.accessContext,
    );
    if (
      input.owner.tenantId !== accessOwner.tenantId ||
      input.owner.workspaceId !== accessOwner.workspaceId
    )
      throw new WorkDefinitionValidationError();
    const definition = await this.definitions.findTeamDefinitionById(
      input.definitionId,
    );
    const version = await this.definitions.findPublishedTeamVersionById(
      input.definitionVersionId,
      input.accessContext,
    );
    assertPublishedDefinition(
      definition,
      version,
      input.definitionId,
      input.owner,
    );
    if (!version) throw new WorkDefinitionValidationError();
    const now = this.now().toISOString();
    return this.repository.createWork(
      createWork({
        id: randomUUID(),
        owner: input.owner,
        definitionId: input.definitionId,
        definitionVersionId: input.definitionVersionId,
        title: input.title,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  public async startWorkRun(input: StartPendingWorkRunInput): Promise<WorkRun> {
    const accessOwner = WorkIdentityApi.ownerFromAccessContext(
      input.accessContext,
    );
    if (
      input.owner.tenantId !== accessOwner.tenantId ||
      input.owner.workspaceId !== accessOwner.workspaceId
    )
      throw new WorkDefinitionValidationError();
    const work = await this.repository.findWorkById(input.workId, input.owner);
    if (!work) throw new WorkNotFoundError();
    const definition = await this.definitions.findTeamDefinitionById(
      work.definitionId,
    );
    const version = await this.definitions.findPublishedTeamVersionById(
      work.currentDefinitionVersionId,
      input.accessContext,
    );
    assertPublishedDefinition(
      definition,
      version,
      work.definitionId,
      input.owner,
    );
    const triggerRef = input.triggerRef ?? randomUUID();
    validateTriggerRef(triggerRef);
    const idempotencyKey = deriveWorkRunIdempotencyKey(
      input.workId,
      input.triggerKind,
      triggerRef,
    );
    const now = this.now();
    return this.repository.createOrLoadPending({
      id: randomUUID(),
      owner: input.owner,
      workId: work.id,
      definitionVersionId: work.currentDefinitionVersionId,
      triggerKind: input.triggerKind,
      triggerRef,
      idempotencyKey,
      expiresAt: new Date(now.getTime() + this.pendingTtlMs).toISOString(),
      now: now.toISOString(),
    });
  }

  /** Controlled same-lineage version pin update; the product title is immutable. */
  public async updateCurrentDefinitionVersion(
    input: UpdateWorkDefinitionVersionInput,
  ): Promise<Work> {
    const accessOwner = WorkIdentityApi.ownerFromAccessContext(
      input.accessContext,
    );
    if (
      input.owner.tenantId !== accessOwner.tenantId ||
      input.owner.workspaceId !== accessOwner.workspaceId
    )
      throw new WorkDefinitionValidationError();
    const work = await this.repository.findWorkById(input.workId, input.owner);
    if (!work) throw new WorkNotFoundError();
    const definition = await this.definitions.findTeamDefinitionById(
      work.definitionId,
    );
    const version = await this.definitions.findPublishedTeamVersionById(
      input.definitionVersionId,
      input.accessContext,
    );
    assertPublishedDefinition(
      definition,
      version,
      work.definitionId,
      input.owner,
    );
    if (!version) throw new WorkDefinitionValidationError();
    if (version.definitionId !== work.definitionId)
      throw new WorkDefinitionValidationError();
    return this.repository.updateCurrentDefinitionVersion({
      workId: work.id,
      owner: input.owner,
      definitionVersionId: version.id,
      title: work.title,
      updatedAt: this.now().toISOString(),
    });
  }

  public async getWorkRun(
    id: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<WorkRun | null> {
    return this.repository.findWorkRunById(id, owner);
  }

  /** Binds the technical root Task while keeping repository writes behind this seam. */
  public bindRootTaskCas(input: BindRootTaskCasInput): Promise<BoundWorkRun> {
    return this.repository.bindRootTaskCas(input);
  }

  public getResolvedManifest(
    workRunId: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<ResolvedResourceManifest | null> {
    return this.repository.getResolvedManifest(workRunId, owner);
  }

  public recordResolvedManifest(
    input: RecordResolvedManifestInput,
  ): Promise<ResolvedResourceManifest> {
    if (this.repository.recordResolvedManifest)
      return this.repository.recordResolvedManifest(input);
    return this.repository.appendResolvedManifest(input);
  }

  public async listWorks(input: ListWorksInput): Promise<WorkListPage> {
    this.assertAccessOwner(input.owner, input.accessContext);
    if (!this.repository.listWorks)
      throw new Error('Work listing is unavailable.');
    return this.repository.listWorks(input.owner, {
      limit: input.limit,
      cursor: input.cursor,
    });
  }
  public async listWorkRuns(
    input: ListWorkRunsInput,
  ): Promise<WorkRunListPage> {
    this.assertAccessOwner(input.owner, input.accessContext);
    if (!this.repository.listWorkRuns)
      throw new Error('Work run listing is unavailable.');
    return this.repository.listWorkRuns(input.owner, input.workId, {
      limit: input.limit,
      cursor: input.cursor,
    });
  }

  public async getWorkDefinition(
    input: GetWorkDefinitionInput,
  ): Promise<WorkDefinitionBinding> {
    this.assertAccessOwner(input.owner, input.accessContext);
    const work = await this.repository.findWorkById(input.workId, input.owner);
    if (!work) throw new WorkNotFoundError();
    const definition = await this.definitions.findTeamDefinitionById(
      work.definitionId,
    );
    const version = await this.definitions.findPublishedTeamVersionById(
      work.currentDefinitionVersionId,
      input.accessContext,
    );
    if (
      !definition ||
      !version ||
      version.definitionId !== work.definitionId ||
      definition.tenantId !== input.owner.tenantId ||
      definition.workspaceId !== input.owner.workspaceId ||
      version.tenantId !== input.owner.tenantId ||
      version.workspaceId !== input.owner.workspaceId ||
      version.status !== 'published'
    )
      throw new WorkNotFoundError();
    return { definition, version };
  }
  private assertAccessOwner(
    owner: WorkIdentityOwnerScope,
    accessContext: AccessContext,
  ): void {
    const accessOwner = WorkIdentityApi.ownerFromAccessContext(accessContext);
    if (
      owner.tenantId !== accessOwner.tenantId ||
      owner.workspaceId !== accessOwner.workspaceId
    )
      throw new WorkDefinitionValidationError();
  }

  /** Converts an authenticated service-account context to the product owner scope. */
  public static ownerFromAccessContext(
    accessContext: AccessContext,
  ): WorkIdentityOwnerScope {
    return {
      tenantId: accessContext.tenantId,
      workspaceId: accessContext.workspaceId,
    };
  }
}

function assertPublishedDefinition(
  definition: Awaited<
    ReturnType<WorkDefinitionReadPort['findTeamDefinitionById']>
  >,
  version: Awaited<
    ReturnType<WorkDefinitionReadPort['findPublishedTeamVersionById']>
  >,
  definitionId: string,
  owner: WorkIdentityOwnerScope,
): asserts definition is NonNullable<typeof definition> {
  if (
    !definition ||
    !version ||
    version.definitionId !== definitionId ||
    definition.tenantId !== owner.tenantId ||
    definition.workspaceId !== owner.workspaceId ||
    version.tenantId !== owner.tenantId ||
    version.workspaceId !== owner.workspaceId ||
    version.status !== 'published'
  ) {
    throw new WorkDefinitionValidationError();
  }
}

export class WorkDefinitionValidationError extends Error {
  public readonly code = 'invalid_work_definition';
  public constructor() {
    super(
      'The definition and published version must belong to this owner scope and lineage.',
    );
    this.name = 'WorkDefinitionValidationError';
  }
}

export function deriveWorkRunIdempotencyKey(
  workId: string,
  triggerKind: 'manual',
  triggerRef: string,
): string {
  return createHash('sha256')
    .update(`${workId}\0${triggerKind}\0${triggerRef}`, 'utf8')
    .digest('hex');
}

function validateTriggerRef(value: string): void {
  if (value.length < 1 || value.length > 256)
    throw new InvalidWorkRunTriggerError();
}

export class InvalidWorkRunTriggerError extends Error {
  public readonly code = 'invalid_trigger_ref';
  public constructor() {
    super('trigger_ref must contain between 1 and 256 characters.');
    this.name = 'InvalidWorkRunTriggerError';
  }
}

export { InvalidWorkListCursorError } from '../ports/work-identity-repository.js';
