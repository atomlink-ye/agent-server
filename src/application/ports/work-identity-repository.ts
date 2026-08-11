import type {
  RecordResolvedManifestInput,
  ResolvedResourceManifest,
  ResolvedResourceManifestEntry,
} from '../../domain/work/resolved-resource-manifest.js';
import type { Work, WorkOwnerScope } from '../../domain/work/work.js';
import type {
  BoundWorkRun,
  PendingWorkRun,
  WorkRun,
  WorkRunTriggerKind,
} from '../../domain/work/work-run.js';

export type WorkIdentityOwnerScope = WorkOwnerScope;

export interface CreateOrLoadPendingWorkRunInput {
  readonly id: string;
  readonly owner: WorkIdentityOwnerScope;
  readonly workId: string;
  readonly definitionVersionId: string;
  readonly triggerKind: WorkRunTriggerKind;
  readonly triggerRef: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  /** Optional single clock sample used for both created and updated timestamps. */
  readonly now?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface FindWorkRunByIdempotencyKeyInput {
  readonly owner: WorkIdentityOwnerScope;
  readonly idempotencyKey: string;
}

export interface WorkIdentityListQuery {
  readonly limit: number;
  readonly cursor: string | null;
}
export interface WorkListPage { readonly items: readonly Work[]; readonly nextCursor: string | null; }
export interface WorkRunListPage { readonly items: readonly WorkRun[]; readonly nextCursor: string | null; }
export class InvalidWorkListCursorError extends Error {
  public readonly code = 'invalid_cursor';
  public constructor() { super('The requested Work list cursor is invalid.'); this.name = 'InvalidWorkListCursorError'; }
}

export interface BindRootTaskCasInput {
  readonly workRunId: string;
  readonly rootTaskId: string;
  readonly owner: WorkIdentityOwnerScope;
  readonly now: string;
}

export interface WorkIdentityRepository {
  createWork(work: Work): Promise<Work>;
  updateCurrentDefinitionVersion(input: {
    readonly workId: string;
    readonly owner: WorkIdentityOwnerScope;
    readonly definitionVersionId: string;
    readonly title: string;
    readonly updatedAt: string;
  }): Promise<Work>;
  findWorkById(id: string, owner: WorkIdentityOwnerScope): Promise<Work | null>;
  createOrLoadPending(input: CreateOrLoadPendingWorkRunInput): Promise<WorkRun>;
  /** Alias retained for coordinators that use the domain wording. */
  startPendingWorkRun?(input: CreateOrLoadPendingWorkRunInput): Promise<WorkRun>;
  findWorkRunById(id: string, owner: WorkIdentityOwnerScope): Promise<WorkRun | null>;
  findWorkRunByIdempotencyKey(
    input: FindWorkRunByIdempotencyKeyInput,
  ): Promise<WorkRun | null>;
  bindRootTaskCas(input: BindRootTaskCasInput): Promise<BoundWorkRun>;
  /** Alias retained for coordinators that use the domain wording. */
  bindRootTask?(input: BindRootTaskCasInput): Promise<BoundWorkRun>;
  appendResolvedManifest(
    input: RecordResolvedManifestInput,
  ): Promise<ResolvedResourceManifest>;
  /** Alias retained for the S9 seam wording. */
  recordResolvedManifest?(
    input: RecordResolvedManifestInput,
  ): Promise<ResolvedResourceManifest>;
  getResolvedManifest(
    workRunId: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<ResolvedResourceManifest | null>;
  listWorks?(owner: WorkIdentityOwnerScope, query: WorkIdentityListQuery): Promise<WorkListPage>;
  listWorkRuns?(owner: WorkIdentityOwnerScope, workId: string, query: WorkIdentityListQuery): Promise<WorkRunListPage>;
}

export type WorkIdentityQuery = Pick<
  WorkIdentityRepository,
  'findWorkById' | 'findWorkRunById' | 'getResolvedManifest'
>;

export type { BoundWorkRun, PendingWorkRun, ResolvedResourceManifestEntry };
export {
  PendingWorkRunExpiredError,
  ResolvedManifestConflictError,
  WorkRunBindingConflictError,
  WorkRunNotFoundError,
} from '../../domain/work/work-run.js';
export { WorkIdentityConflictError, WorkNotFoundError } from '../../domain/work/work.js';
