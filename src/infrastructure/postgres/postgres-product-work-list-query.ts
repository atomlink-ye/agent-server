import {
  InvalidProductWorkListCursorError,
  type ProductListQuery,
  type ProductWorkListPage,
  type ProductWorkListQuery,
  type ProductWorkRunListPage,
} from '../../application/ports/product-work-list-query.js';
import type { WorkIdentityOwnerScope } from '../../application/ports/work-identity-repository.js';
import type { Work } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
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

type CursorKind = 'works_updated_desc' | 'work_runs_created_desc';
type CursorPayload = {
  readonly kind: CursorKind;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly sortAt: string;
  readonly id: string;
  readonly workId?: string;
};

const workColumns =
  'id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,archived_at,created_at,updated_at';
const runColumns =
  'id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,root_task_id,expires_at,bound_at,created_at,updated_at';

export class PostgresProductWorkListQuery implements ProductWorkListQuery {
  public constructor(private readonly database: Queryable) {}

  public async listWorksLatestFirst(
    owner: WorkIdentityOwnerScope,
    query: ProductListQuery,
  ): Promise<ProductWorkListPage> {
    assertLimit(query.limit);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, 'works_updated_desc', owner)
      : null;
    const values: unknown[] = [
      owner.tenantId,
      owner.workspaceId,
      query.limit + 1,
    ];
    const cursorSql = cursor
      ? ' AND (updated_at,id) < ($4::timestamptz,$5::uuid)'
      : '';
    if (cursor) values.push(cursor.sortAt, cursor.id);
    const result = await this.database.query<WorkRow>(
      `SELECT ${workColumns} FROM works
       WHERE tenant_id=$1 AND workspace_id=$2 AND archived_at IS NULL${cursorSql}
       ORDER BY updated_at DESC,id DESC LIMIT $3`,
      values,
    );
    const items = (result.rows ?? []).map(mapWork);
    const pageItems = items.slice(0, query.limit);
    const last = pageItems.at(-1);
    return {
      items: pageItems,
      nextCursor:
        items.length > query.limit && last
          ? encodeCursor({
              kind: 'works_updated_desc',
              tenantId: owner.tenantId,
              workspaceId: owner.workspaceId,
              sortAt: last.updatedAt,
              id: last.id,
            })
          : null,
    };
  }

  public async listWorkRunsLatestFirst(
    owner: WorkIdentityOwnerScope,
    workId: string,
    query: ProductListQuery,
  ): Promise<ProductWorkRunListPage> {
    assertLimit(query.limit);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, 'work_runs_created_desc', owner, workId)
      : null;
    const values: unknown[] = [
      owner.tenantId,
      owner.workspaceId,
      workId,
      query.limit + 1,
    ];
    const cursorSql = cursor
      ? ' AND (created_at,id) < ($5::timestamptz,$6::uuid)'
      : '';
    if (cursor) values.push(cursor.sortAt, cursor.id);
    const result = await this.database.query<WorkRunRow>(
      `SELECT ${runColumns} FROM work_runs
       WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
         AND (root_task_id IS NOT NULL OR expires_at > now())${cursorSql}
       ORDER BY created_at DESC,id DESC LIMIT $4`,
      values,
    );
    const items = (result.rows ?? []).map(mapWorkRun);
    const pageItems = items.slice(0, query.limit);
    const last = pageItems.at(-1);
    return {
      items: pageItems,
      nextCursor:
        items.length > query.limit && last
          ? encodeCursor({
              kind: 'work_runs_created_desc',
              tenantId: owner.tenantId,
              workspaceId: owner.workspaceId,
              sortAt: last.createdAt,
              id: last.id,
              workId,
            })
          : null,
    };
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

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(
  value: string,
  kind: CursorKind,
  owner: WorkIdentityOwnerScope,
  workId?: string,
): CursorPayload {
  try {
    if (
      value.length === 0 ||
      value.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const payload = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const expectedKeys =
      kind === 'works_updated_desc'
        ? ['id', 'kind', 'sortAt', 'tenantId', 'workspaceId']
        : ['id', 'kind', 'sortAt', 'tenantId', 'workId', 'workspaceId'];
    const keys = Object.keys(payload).sort();
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    )
      throw new Error();
    if (
      payload.kind !== kind ||
      payload.tenantId !== owner.tenantId ||
      payload.workspaceId !== owner.workspaceId ||
      (kind === 'work_runs_created_desc' && payload.workId !== workId) ||
      typeof payload.sortAt !== 'string' ||
      payload.sortAt !== new Date(payload.sortAt).toISOString() ||
      typeof payload.id !== 'string' ||
      !isCanonicalUuid(payload.id)
    )
      throw new Error();
    if (
      Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url') !==
      value
    )
      throw new Error();
    return payload as unknown as CursorPayload;
  } catch {
    throw new InvalidProductWorkListCursorError();
  }
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('The requested Product Work list limit is invalid.');
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
