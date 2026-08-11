import type {
  WorkIdentityRepository,
  WorkIdentityOwnerScope,
  CreateOrLoadPendingWorkRunInput,
  BindRootTaskCasInput,
} from '../../application/ports/work-identity-repository.js';
import type { ExecutionAdmission } from '../../application/ports/execution-admission.js';
import type { WorkDefinitionReadPort } from '../../application/ports/work-definition-read.js';
import {
  WorkIdentityApi,
  type WorkIdentityApiOptions,
} from '../../application/work/work-identity-api.js';
import {
  StartWorkRun,
  type StartWorkRunOptions,
} from '../../application/work/start-work-run.js';
import {
  WorkIdentityConflictError,
  WorkNotFoundError,
  type Work,
} from '../../domain/work/work.js';
import {
  PendingWorkRunExpiredError,
  ResolvedManifestConflictError,
  WorkRunBindingConflictError,
  WorkRunNotFoundError,
  type WorkRun,
  type BoundWorkRun,
} from '../../domain/work/work-run.js';
import {
  validateManifestEntries,
  type RecordResolvedManifestInput,
  type ResolvedResourceManifest,
  type ResolvedResourceManifestEntry,
} from '../../domain/work/resolved-resource-manifest.js';

export interface WorkIdentityQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

export interface WorkIdentityClient extends WorkIdentityQueryable {
  release(): void;
}

export interface WorkIdentityConnectable extends WorkIdentityQueryable {
  connect(): Promise<WorkIdentityClient>;
}

type Database = WorkIdentityQueryable | WorkIdentityConnectable;

export interface PostgresWorkIdentityModuleOptions {
  readonly database: Database;
  readonly definitions: WorkDefinitionReadPort;
  readonly execution: ExecutionAdmission;
  readonly now?: () => Date;
  readonly pendingTtlMs?: number;
}

export interface PostgresWorkIdentityModule {
  readonly workIdentity: WorkIdentityApi;
  readonly workIdentityQuery: Pick<
    WorkIdentityRepository,
    'findWorkById' | 'findWorkRunById'
  >;
  readonly startWorkRun: StartWorkRun;
}

/** Composes the production Work identity application module over PostgreSQL. */
export function createPostgresWorkIdentityModule(
  options: PostgresWorkIdentityModuleOptions,
): PostgresWorkIdentityModule {
  const workIdentityRepository = new PostgresWorkIdentityRepository(
    options.database,
  );
  const identityOptions: WorkIdentityApiOptions = {
    repository: workIdentityRepository,
    definitions: options.definitions,
    ...(options.now ? { now: options.now } : {}),
    ...(options.pendingTtlMs !== undefined
      ? { pendingTtlMs: options.pendingTtlMs }
      : {}),
  };
  const workIdentity = new WorkIdentityApi(identityOptions);
  const startWorkRunOptions: StartWorkRunOptions = {
    identity: workIdentity,
    execution: options.execution,
    ...(options.now ? { now: options.now } : {}),
  };
  const startWorkRun = new StartWorkRun(startWorkRunOptions);
  return {
    workIdentity,
    workIdentityQuery: workIdentityRepository,
    startWorkRun,
  };
}

type WorkRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  definition_id: string;
  current_definition_version_id: string;
  title: string;
  origin: Work['origin'];
  archived_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type WorkRunRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  work_id: string;
  definition_version_id: string;
  trigger_kind: WorkRun['triggerKind'];
  trigger_ref: string;
  idempotency_key: string;
  root_task_id: string | null;
  expires_at: string | Date;
  bound_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type ManifestRow = {
  work_run_id: string;
  tenant_id: string;
  workspace_id: string;
  slot: string;
  resource_kind: ResolvedResourceManifestEntry['resourceKind'];
  requested_ref: string | null;
  resolved_version_id: string;
  resolved_fingerprint: string | null;
  resolved_at: string | Date;
};

const workColumns =
  'id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,archived_at,created_at,updated_at';
const runColumns =
  'id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,root_task_id,expires_at,bound_at,created_at,updated_at';
const manifestColumns =
  'work_run_id,tenant_id,workspace_id,slot,resource_kind,requested_ref,resolved_version_id,resolved_fingerprint,resolved_at';

export class PostgresWorkIdentityRepository implements WorkIdentityRepository {
  public constructor(private readonly database: Database) {}

  public async createWork(work: Work): Promise<Work> {
    const inserted = await this.database.query<WorkRow>(
      `INSERT INTO works (${workColumns})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${workColumns}`,
      [
        work.id,
        work.tenantId,
        work.workspaceId,
        work.definitionId,
        work.currentDefinitionVersionId,
        work.title,
        work.origin,
        work.archivedAt,
        work.createdAt,
        work.updatedAt,
      ],
    );
    const row =
      inserted.rows?.[0] ??
      (
        await this.database.query<WorkRow>(
          `SELECT ${workColumns} FROM works WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`,
          [work.id, work.tenantId, work.workspaceId],
        )
      ).rows?.[0];
    if (!row) {
      const existing = await this.database.query<{ id: string }>(
        'SELECT id FROM works WHERE id=$1',
        [work.id],
      );
      if (existing.rows?.[0])
        throw new WorkIdentityConflictError(
          'The work id belongs to another owner scope.',
        );
      throw new Error('The work could not be persisted.');
    }
    const result = mapWork(row);
    assertWorkEquivalent(work, result);
    return result;
  }

  public async findWorkById(
    id: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<Work | null> {
    const result = await this.database.query<WorkRow>(
      `SELECT ${workColumns} FROM works
       WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`,
      [id, owner.tenantId, owner.workspaceId],
    );
    return result.rows?.[0] ? mapWork(result.rows[0]) : null;
  }

  public async updateCurrentDefinitionVersion(input: {
    workId: string;
    owner: WorkIdentityOwnerScope;
    definitionVersionId: string;
    title: string;
    updatedAt: string;
  }): Promise<Work> {
    const result = await this.database.query<WorkRow>(
      `UPDATE works SET current_definition_version_id=$1, updated_at=$2
       WHERE id=$3 AND tenant_id=$4 AND workspace_id=$5 AND title=$6
       RETURNING ${workColumns}`,
      [
        input.definitionVersionId,
        input.updatedAt,
        input.workId,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.title,
      ],
    );
    if (result.rows?.[0]) return mapWork(result.rows[0]);
    throw new WorkNotFoundError();
  }

  public async createOrLoadPending(
    input: CreateOrLoadPendingWorkRunInput,
  ): Promise<WorkRun> {
    const inserted = await this.database.query<WorkRunRow>(
      `INSERT INTO work_runs
       (id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,root_task_id,expires_at,bound_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,NULL,$10,$11)
       ON CONFLICT (tenant_id,workspace_id,idempotency_key) DO NOTHING
       RETURNING ${runColumns}`,
      [
        input.id,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.workId,
        input.definitionVersionId,
        input.triggerKind,
        input.triggerRef,
        input.idempotencyKey,
        input.expiresAt,
        input.createdAt ?? input.now ?? new Date().toISOString(),
        input.updatedAt ??
          input.now ??
          input.createdAt ??
          new Date().toISOString(),
      ],
    );
    const row =
      inserted.rows?.[0] ??
      (
        await this.database.query<WorkRunRow>(
          `SELECT ${runColumns} FROM work_runs
       WHERE tenant_id=$1 AND workspace_id=$2 AND idempotency_key=$3`,
          [input.owner.tenantId, input.owner.workspaceId, input.idempotencyKey],
        )
      ).rows?.[0];
    if (!row) throw new Error('The pending work run could not be persisted.');
    const run = mapWorkRun(row);
    if (
      run.workId !== input.workId ||
      run.definitionVersionId !== input.definitionVersionId ||
      run.triggerKind !== input.triggerKind ||
      run.triggerRef !== input.triggerRef
    ) {
      throw new WorkIdentityConflictError(
        'The idempotency key was reused with a different work trigger.',
      );
    }
    return run;
  }

  public startPendingWorkRun(
    input: CreateOrLoadPendingWorkRunInput,
  ): Promise<WorkRun> {
    return this.createOrLoadPending(input);
  }

  public async findWorkRunById(
    id: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<WorkRun | null> {
    const result = await this.database.query<WorkRunRow>(
      `SELECT ${runColumns} FROM work_runs
       WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`,
      [id, owner.tenantId, owner.workspaceId],
    );
    return result.rows?.[0] ? mapWorkRun(result.rows[0]) : null;
  }

  public async findWorkRunByIdempotencyKey(input: {
    owner: WorkIdentityOwnerScope;
    idempotencyKey: string;
  }): Promise<WorkRun | null> {
    const result = await this.database.query<WorkRunRow>(
      `SELECT ${runColumns} FROM work_runs
       WHERE tenant_id=$1 AND workspace_id=$2 AND idempotency_key=$3`,
      [input.owner.tenantId, input.owner.workspaceId, input.idempotencyKey],
    );
    return result.rows?.[0] ? mapWorkRun(result.rows[0]) : null;
  }

  public async bindRootTaskCas(
    input: BindRootTaskCasInput,
  ): Promise<BoundWorkRun> {
    let updated: { readonly rows?: readonly WorkRunRow[] };
    try {
      updated = await this.database.query<WorkRunRow>(
        `UPDATE work_runs
       SET root_task_id=$1, bound_at=COALESCE(bound_at,$2), updated_at=$2
       WHERE id=$3 AND tenant_id=$4 AND workspace_id=$5
         AND (root_task_id=$1 OR (root_task_id IS NULL AND expires_at>$2))
       RETURNING ${runColumns}`,
        [
          input.rootTaskId,
          input.now,
          input.workRunId,
          input.owner.tenantId,
          input.owner.workspaceId,
        ],
      );
    } catch (error) {
      if (isRootTaskUniqueViolation(error))
        throw new WorkRunBindingConflictError();
      throw error;
    }
    if (updated.rows?.[0]) return asBoundWorkRun(mapWorkRun(updated.rows[0]));

    const existing = await this.findWorkRunById(input.workRunId, input.owner);
    if (!existing) throw new WorkRunNotFoundError();
    if (existing.rootTaskId === input.rootTaskId)
      return asBoundWorkRun(existing);
    if (!existing.rootTaskId) {
      if (
        new Date(existing.expiresAt).getTime() <= new Date(input.now).getTime()
      )
        throw new PendingWorkRunExpiredError();
      throw new WorkRunBindingConflictError();
    }
    throw new WorkRunBindingConflictError();
  }

  public bindRootTask(input: BindRootTaskCasInput): Promise<BoundWorkRun> {
    return this.bindRootTaskCas(input);
  }

  public async appendResolvedManifest(
    input: RecordResolvedManifestInput,
  ): Promise<ResolvedResourceManifest> {
    validateManifestEntries(input.entries);
    const client = await this.transactionClient();
    let committed = false;
    try {
      await client.query('BEGIN');
      const run = await client.query<{
        id: string;
        root_task_id: string | null;
      }>(
        `SELECT id,root_task_id FROM work_runs WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 FOR UPDATE`,
        [input.workRunId, input.owner.tenantId, input.owner.workspaceId],
      );
      if (!run.rows?.[0]) throw new WorkRunNotFoundError();
      if (!run.rows[0].root_task_id) throw new WorkRunBindingConflictError();
      const existingRows = await client.query<ManifestRow>(
        `SELECT ${manifestColumns} FROM work_run_resource_manifest
         WHERE work_run_id=$1 AND tenant_id=$2 AND workspace_id=$3 ORDER BY slot FOR UPDATE`,
        [input.workRunId, input.owner.tenantId, input.owner.workspaceId],
      );
      const existingEntries = (existingRows.rows ?? []).map(mapManifestEntry);
      if (existingEntries.length > 0) {
        if (!manifestEntriesEqual(existingEntries, input.entries))
          throw new ResolvedManifestConflictError();
        await client.query('COMMIT');
        committed = true;
        return {
          workRunId: input.workRunId,
          tenantId: input.owner.tenantId,
          workspaceId: input.owner.workspaceId,
          entries: existingEntries,
        };
      }
      for (const entry of input.entries) {
        await client.query(
          `INSERT INTO work_run_resource_manifest
           (${manifestColumns})
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (work_run_id,slot) DO NOTHING`,
          [
            input.workRunId,
            input.owner.tenantId,
            input.owner.workspaceId,
            entry.slot,
            entry.resourceKind,
            entry.requestedRef,
            entry.resolvedVersionId,
            entry.resolvedFingerprint,
            entry.resolvedAt,
          ],
        );
      }
      const rows = await client.query<ManifestRow>(
        `SELECT ${manifestColumns} FROM work_run_resource_manifest
         WHERE work_run_id=$1 AND tenant_id=$2 AND workspace_id=$3 ORDER BY slot`,
        [input.workRunId, input.owner.tenantId, input.owner.workspaceId],
      );
      const mapped = (rows.rows ?? []).map(mapManifestEntry);
      if (!manifestEntriesEqual(mapped, input.entries))
        throw new ResolvedManifestConflictError();
      await client.query('COMMIT');
      committed = true;
      return {
        workRunId: input.workRunId,
        tenantId: input.owner.tenantId,
        workspaceId: input.owner.workspaceId,
        entries: mapped,
      };
    } catch (error) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original failure.
        }
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  public recordResolvedManifest(
    input: RecordResolvedManifestInput,
  ): Promise<ResolvedResourceManifest> {
    return this.appendResolvedManifest(input);
  }

  public async getResolvedManifest(
    workRunId: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<ResolvedResourceManifest | null> {
    const rows = await this.database.query<ManifestRow>(
      `SELECT ${manifestColumns} FROM work_run_resource_manifest
       WHERE work_run_id=$1 AND tenant_id=$2 AND workspace_id=$3 ORDER BY slot`,
      [workRunId, owner.tenantId, owner.workspaceId],
    );
    if (!rows.rows?.length) return null;
    return {
      workRunId,
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      entries: rows.rows.map(mapManifestEntry),
    };
  }

  public async listWorkRuns(
    owner: WorkIdentityOwnerScope,
    options: { readonly includePending?: boolean } = {},
  ): Promise<readonly WorkRun[]> {
    const predicate = options.includePending
      ? '(root_task_id IS NOT NULL OR expires_at > now())'
      : 'root_task_id IS NOT NULL';
    const rows = await this.database.query<WorkRunRow>(
      `SELECT ${runColumns} FROM work_runs
       WHERE tenant_id=$1 AND workspace_id=$2 AND ${predicate}
       ORDER BY created_at DESC, id DESC`,
      [owner.tenantId, owner.workspaceId],
    );
    return (rows.rows ?? []).map(mapWorkRun);
  }

  private async transactionClient(): Promise<WorkIdentityClient> {
    if (
      'connect' in this.database &&
      typeof this.database.connect === 'function'
    )
      return this.database.connect();
    return this.database as WorkIdentityClient;
  }
}

function mapWork(row: WorkRow): Work {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    definitionId: row.definition_id,
    currentDefinitionVersionId: row.current_definition_version_id,
    title: row.title,
    origin: row.origin,
    archivedAt: toIsoOrNull(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapWorkRun(row: WorkRunRow): WorkRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    workId: row.work_id,
    definitionVersionId: row.definition_version_id,
    triggerKind: row.trigger_kind,
    triggerRef: row.trigger_ref,
    idempotencyKey: row.idempotency_key,
    rootTaskId: row.root_task_id,
    expiresAt: toIso(row.expires_at),
    boundAt: toIsoOrNull(row.bound_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapManifestEntry(row: ManifestRow): ResolvedResourceManifestEntry {
  return {
    slot: row.slot,
    resourceKind: row.resource_kind,
    requestedRef: row.requested_ref,
    resolvedVersionId: row.resolved_version_id,
    resolvedFingerprint: row.resolved_fingerprint,
    resolvedAt: toIso(row.resolved_at),
  };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}

function assertWorkEquivalent(expected: Work, actual: Work): void {
  if (
    expected.id !== actual.id ||
    expected.tenantId !== actual.tenantId ||
    expected.workspaceId !== actual.workspaceId ||
    expected.definitionId !== actual.definitionId ||
    expected.currentDefinitionVersionId !== actual.currentDefinitionVersionId ||
    expected.title !== actual.title ||
    expected.origin !== actual.origin ||
    expected.archivedAt !== actual.archivedAt ||
    expected.createdAt !== actual.createdAt ||
    expected.updatedAt !== actual.updatedAt
  ) {
    throw new WorkIdentityConflictError();
  }
}

function asBoundWorkRun(run: WorkRun): BoundWorkRun {
  if (!run.rootTaskId || !run.boundAt)
    throw new Error('Expected a bound work run.');
  return run as BoundWorkRun;
}

function manifestEntryEqual(
  left: ResolvedResourceManifestEntry,
  right: ResolvedResourceManifestEntry,
): boolean {
  return (
    left.slot === right.slot &&
    left.resourceKind === right.resourceKind &&
    left.requestedRef === right.requestedRef &&
    left.resolvedVersionId === right.resolvedVersionId &&
    left.resolvedFingerprint === right.resolvedFingerprint &&
    left.resolvedAt === right.resolvedAt
  );
}

function manifestEntriesEqual(
  left: readonly ResolvedResourceManifestEntry[],
  right: readonly ResolvedResourceManifestEntry[],
): boolean {
  const orderedLeft = [...left].sort((a, b) => a.slot.localeCompare(b.slot));
  const orderedRight = [...right].sort((a, b) => a.slot.localeCompare(b.slot));
  return (
    orderedLeft.length === orderedRight.length &&
    orderedLeft.every((entry, index) =>
      manifestEntryEqual(entry, orderedRight[index]!),
    )
  );
}

function isRootTaskUniqueViolation(error: unknown): boolean {
  const value = error as {
    readonly code?: string;
    readonly constraint?: string;
  };
  return (
    value?.code === '23505' &&
    value.constraint === 'work_runs_root_task_bound_unique'
  );
}
