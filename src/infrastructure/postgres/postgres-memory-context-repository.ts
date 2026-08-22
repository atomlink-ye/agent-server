import { randomUUID } from 'node:crypto';

import type {
  ContextTransitionRecord,
  ContextTransitionRepository,
  MemoryContextRecordRef,
  MemoryContextRepository,
} from '../../application/ports/memory-context-repository.js';
import {
  contextScopeKind,
  contextScopeStorageKey,
  contextScopeTenantId,
  type ContextScope,
} from '../../domain/context/context-fs.js';
import type { MemorySource } from '../../domain/context/memory-context.js';

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly T[]; readonly rowCount?: number | null }>;
}

type MemoryRow = {
  memory_id: string;
  tenant_id: string;
  scope_json: ContextScope | string;
  logical_path: string;
  source_kind: MemorySource['kind'];
  source_id: string | null;
  pinned: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

type TransitionRow = {
  id: string;
  tenant_id: string;
  transition_kind: ContextTransitionRecord['kind'];
  source_scope_json: ContextScope | string;
  source_path: string;
  target_scope_json: ContextScope | string;
  target_path: string;
  source_sha256: string;
  created_at: string | Date;
};

export class PostgresMemoryContextRepository implements MemoryContextRepository {
  public constructor(private readonly database: Queryable) {}

  public async upsert(input: {
    readonly memoryId: string;
    readonly scope: ContextScope;
    readonly logicalPath: string;
    readonly source: MemorySource;
    readonly pinned: boolean;
    readonly now: string;
  }): Promise<MemoryContextRecordRef> {
    const result = await this.database.query<MemoryRow>(
      `INSERT INTO memory_context_records
       (memory_id,tenant_id,scope_kind,scope_key,scope_json,logical_path,
        source_kind,source_id,pinned,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (memory_id) DO UPDATE SET
         scope_kind=EXCLUDED.scope_kind,
         scope_key=EXCLUDED.scope_key,
         scope_json=EXCLUDED.scope_json,
         logical_path=EXCLUDED.logical_path,
         source_kind=EXCLUDED.source_kind,
         source_id=EXCLUDED.source_id,
         pinned=EXCLUDED.pinned,
         updated_at=EXCLUDED.updated_at
       WHERE memory_context_records.tenant_id=EXCLUDED.tenant_id
       RETURNING memory_id,tenant_id,scope_json,logical_path,source_kind,
                 source_id,pinned,created_at,updated_at`,
      [
        input.memoryId,
        contextScopeTenantId(input.scope),
        contextScopeKind(input.scope),
        contextScopeStorageKey(input.scope),
        JSON.stringify(input.scope),
        input.logicalPath,
        input.source.kind,
        input.source.sourceId ?? null,
        input.pinned,
        input.now,
      ],
    );
    const row = result.rows?.[0];
    if (!row) throw new Error('Memory provenance could not be persisted.');
    return mapMemory(row);
  }

  public async find(memoryId: string, tenantId: string): Promise<MemoryContextRecordRef | null> {
    const result = await this.database.query<MemoryRow>(
      `SELECT memory_id,tenant_id,scope_json,logical_path,source_kind,
              source_id,pinned,created_at,updated_at
         FROM memory_context_records
        WHERE memory_id=$1 AND tenant_id=$2`,
      [memoryId, tenantId],
    );
    return result.rows?.[0] ? mapMemory(result.rows[0]) : null;
  }

  public async listByTenant(tenantId: string): Promise<readonly MemoryContextRecordRef[]> {
    const result = await this.database.query<MemoryRow>(
      `SELECT memory_id,tenant_id,scope_json,logical_path,source_kind,
              source_id,pinned,created_at,updated_at
         FROM memory_context_records
        WHERE tenant_id=$1 ORDER BY created_at,memory_id`,
      [tenantId],
    );
    return Object.freeze((result.rows ?? []).map(mapMemory));
  }
}

export class PostgresContextTransitionRepository implements ContextTransitionRepository {
  public constructor(private readonly database: Queryable) {}

  public async record(
    input: Omit<ContextTransitionRecord, 'id'>,
  ): Promise<ContextTransitionRecord> {
    if (contextScopeTenantId(input.sourceScope) !== input.tenantId ||
        contextScopeTenantId(input.targetScope) !== input.tenantId) {
      throw new Error('Context transition cannot cross tenants.');
    }
    const id = randomUUID();
    const result = await this.database.query<TransitionRow>(
      `INSERT INTO context_transitions
       (id,tenant_id,transition_kind,source_scope_kind,source_scope_key,
        source_scope_json,source_path,target_scope_kind,target_scope_key,
        target_scope_json,target_path,source_sha256,created_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13)
       ON CONFLICT
       (tenant_id,transition_kind,source_scope_kind,source_scope_key,source_path,
        target_scope_kind,target_scope_key,target_path,source_sha256)
       DO UPDATE SET created_at=context_transitions.created_at
       RETURNING id,tenant_id,transition_kind,source_scope_json,source_path,
                 target_scope_json,target_path,source_sha256,created_at`,
      [
        id,
        input.tenantId,
        input.kind,
        contextScopeKind(input.sourceScope),
        contextScopeStorageKey(input.sourceScope),
        JSON.stringify(input.sourceScope),
        input.sourcePath,
        contextScopeKind(input.targetScope),
        contextScopeStorageKey(input.targetScope),
        JSON.stringify(input.targetScope),
        input.targetPath,
        input.sourceSha256,
        input.createdAt,
      ],
    );
    const row = result.rows?.[0];
    if (!row) throw new Error('Context transition could not be recorded.');
    return Object.freeze({
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.transition_kind,
      sourceScope: parseScope(row.source_scope_json),
      sourcePath: row.source_path,
      targetScope: parseScope(row.target_scope_json),
      targetPath: row.target_path,
      sourceSha256: row.source_sha256,
      createdAt: iso(row.created_at),
    });
  }
}

function mapMemory(row: MemoryRow): MemoryContextRecordRef {
  return Object.freeze({
    memoryId: row.memory_id,
    tenantId: row.tenant_id,
    scope: parseScope(row.scope_json),
    logicalPath: row.logical_path,
    source: Object.freeze({
      kind: row.source_kind,
      ...(row.source_id ? { sourceId: row.source_id } : {}),
    }),
    pinned: row.pinned,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function parseScope(value: ContextScope | string): ContextScope {
  const scope = typeof value === 'string' ? JSON.parse(value) : value;
  if (!scope || typeof scope !== 'object' || typeof (scope as any).kind !== 'string')
    throw new Error('Persisted ContextScope is invalid.');
  return Object.freeze(scope as ContextScope);
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
