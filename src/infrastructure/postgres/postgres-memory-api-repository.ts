import type {
  CreateMemoryInput,
  CreateMemoryStoreInput,
  MemoryApiRepository,
  UpdateMemoryInput,
} from '../../application/ports/memory-api-repository.js';
import { MemoryPreconditionFailedError } from '../../application/ports/memory-api-repository.js';
import type {
  Memory,
  MemoryApiPrincipalScope,
  MemoryStore,
  MemoryVersion,
} from '../../domain/memory-api/memory-api.js';
import {
  contentSizeBytes,
  sha256,
} from '../../domain/memory-api/memory-api.js';
import { MemoryPathConflictError } from '../../domain/memory-api/memory-api.js';

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly T[]; rowCount?: number | null }>;
}
interface Client extends Queryable {
  release?: () => void;
}
type Database = Queryable | (Queryable & { connect(): Promise<Client> });
type StoreRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  name: string;
  description: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};
type MemoryRow = {
  memory_id: string;
  memory_store_id: string;
  path: string;
  memory_created_at: string | Date;
  memory_updated_at: string | Date;
  memory_version_id: string;
  version: number;
  content: string;
  content_sha256: string;
  content_size_bytes: number;
  operation: 'created' | 'modified';
  previous_version_id: string | null;
  version_created_at: string | Date;
};

const STORE_COLUMNS =
  'id, tenant_id, workspace_id, principal_type, principal_id, name, description, created_at, updated_at';
const MEMORY_COLUMNS =
  'm.id AS memory_id, m.memory_store_id, m.path, m.created_at AS memory_created_at, ' +
  'm.updated_at AS memory_updated_at, v.id AS memory_version_id, v.version, v.content, ' +
  'v.content_sha256, v.content_size_bytes, v.operation, v.previous_version_id, ' +
  'v.created_at AS version_created_at';

export class PostgresMemoryApiRepository implements MemoryApiRepository {
  public constructor(private readonly database: Database) {}

  public async createStore(
    input: CreateMemoryStoreInput,
  ): Promise<MemoryStore | null> {
    const now = new Date().toISOString();
    const result = await this.database.query<StoreRow>(
      `INSERT INTO memory_stores (${STORE_COLUMNS})
         SELECT $1, w.tenant_id, w.id, w.principal_type, w.principal_id, $6, $7, $8, $8
         FROM workspaces w
         WHERE w.id = $2 AND w.tenant_id = $3 AND w.principal_type = $4 AND w.principal_id = $5
         RETURNING ${STORE_COLUMNS}`,
      [
        input.id,
        input.workspaceId,
        input.principal.tenantId,
        input.principal.principalType,
        input.principal.principalId,
        input.name,
        input.description,
        now,
      ],
    );
    return result.rows?.[0] ? mapStore(result.rows[0]) : null;
  }

  public async listStores(
    principal: MemoryApiPrincipalScope,
    workspaceId: string,
  ): Promise<readonly MemoryStore[] | null> {
    const workspace = await this.database.query<{ id: string }>(
      `SELECT id FROM workspaces
       WHERE id = $1 AND tenant_id = $2 AND principal_type = $3 AND principal_id = $4`,
      [
        workspaceId,
        principal.tenantId,
        principal.principalType,
        principal.principalId,
      ],
    );
    if (!workspace.rows?.[0]) return null;
    const result = await this.database.query<StoreRow>(
      `SELECT ${STORE_COLUMNS} FROM memory_stores
       WHERE tenant_id = $1 AND workspace_id = $2 AND principal_type = $3 AND principal_id = $4
       ORDER BY created_at, id`,
      [
        principal.tenantId,
        workspaceId,
        principal.principalType,
        principal.principalId,
      ],
    );
    return (result.rows ?? []).map(mapStore);
  }

  public async getStore(
    id: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<MemoryStore | null> {
    const result = await this.database.query<StoreRow>(
      `SELECT ${STORE_COLUMNS} FROM memory_stores
       WHERE id = $1 AND tenant_id = $2 AND principal_type = $3 AND principal_id = $4`,
      [id, principal.tenantId, principal.principalType, principal.principalId],
    );
    return result.rows?.[0] ? mapStore(result.rows[0]) : null;
  }

  public async createMemory(
    input: CreateMemoryInput,
    principal: MemoryApiPrincipalScope,
  ): Promise<Memory | null> {
    const client = await this.client();
    const size = contentSizeBytes(input.content);
    const hash = sha256(input.content);
    await client.query('BEGIN');
    try {
      let inserted: { rows?: readonly { memory_id: string }[] };
      try {
        inserted = await client.query<{ memory_id: string }>(
          `INSERT INTO memories
           (id, memory_store_id, path, current_version_id, created_at, updated_at)
           SELECT $1, s.id, $3, $4, $5, $5 FROM memory_stores s
           WHERE s.id = $2 AND s.tenant_id = $6 AND s.principal_type = $7 AND s.principal_id = $8
           RETURNING id AS memory_id`,
          [
            input.id,
            input.storeId,
            input.path,
            input.versionId,
            input.now,
            principal.tenantId,
            principal.principalType,
            principal.principalId,
          ],
        );
      } catch (error) {
        if (isMemoryPathConflict(error)) throw new MemoryPathConflictError();
        throw error;
      }
      if (!inserted.rows?.[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `INSERT INTO memory_versions
         (id, memory_id, version, content, content_sha256, content_size_bytes,
          operation, previous_version_id, created_at)
         VALUES ($1, $2, 1, $3, $4, $5, 'created', NULL, $6)`,
        [input.versionId, input.id, input.content, hash, size, input.now],
      );
      await client.query(
        'UPDATE memories SET current_version_id = $1 WHERE id = $2',
        [input.versionId, input.id],
      );
      const row = await selectMemory(
        client,
        input.storeId,
        input.id,
        principal,
      );
      await client.query('COMMIT');
      return row ? mapMemory(row) : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }

  public async listMemories(
    storeId: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<readonly Memory[] | null> {
    const store = await this.database.query<{ id: string }>(
      `SELECT id FROM memory_stores
       WHERE id = $1 AND tenant_id = $2 AND principal_type = $3 AND principal_id = $4`,
      [
        storeId,
        principal.tenantId,
        principal.principalType,
        principal.principalId,
      ],
    );
    if (!store.rows?.[0]) return null;
    const result = await this.database.query<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM memories m
       JOIN memory_versions v ON v.id = m.current_version_id AND v.memory_id = m.id
       WHERE m.memory_store_id = $1 ORDER BY m.path`,
      [storeId],
    );
    return (result.rows ?? []).map(mapMemory);
  }

  public async getMemory(
    storeId: string,
    memoryId: string,
    principal: MemoryApiPrincipalScope,
  ): Promise<Memory | null> {
    const row = await selectMemory(this.database, storeId, memoryId, principal);
    return row ? mapMemory(row) : null;
  }

  public async updateMemory(input: UpdateMemoryInput): Promise<Memory | null> {
    const client = await this.client();
    const size = contentSizeBytes(input.content);
    const hash = sha256(input.content);
    await client.query('BEGIN');
    try {
      const row = await selectMemory(
        client,
        input.storeId,
        input.memoryId,
        input.principal,
        true,
      );
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      if (row.content_sha256 !== input.expectedSha256) {
        throw new MemoryPreconditionFailedError();
      }
      if (row.content_sha256 === hash) {
        await client.query('COMMIT');
        return mapMemory(row);
      }
      await client.query(
        `INSERT INTO memory_versions
         (id, memory_id, version, content, content_sha256, content_size_bytes,
          operation, previous_version_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'modified', $7, $8)`,
        [
          input.versionId,
          input.memoryId,
          row.version + 1,
          input.content,
          hash,
          size,
          row.memory_version_id,
          input.now,
        ],
      );
      await client.query(
        'UPDATE memories SET current_version_id = $1, updated_at = $2 WHERE id = $3',
        [input.versionId, input.now, input.memoryId],
      );
      const updated = await selectMemory(
        client,
        input.storeId,
        input.memoryId,
        input.principal,
      );
      await client.query('COMMIT');
      return updated ? mapMemory(updated) : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }

  private async client(): Promise<Client> {
    return 'connect' in this.database ? this.database.connect() : this.database;
  }
}

async function selectMemory(
  database: Queryable,
  storeId: string,
  memoryId: string,
  principal: MemoryApiPrincipalScope,
  forUpdate = false,
): Promise<MemoryRow | null> {
  const result = await database.query<MemoryRow>(
    `SELECT ${MEMORY_COLUMNS} FROM memories m
     JOIN memory_versions v ON v.id = m.current_version_id AND v.memory_id = m.id
     JOIN memory_stores s ON s.id = m.memory_store_id
     WHERE m.id = $1 AND s.id = $2 AND s.tenant_id = $3
       AND s.principal_type = $4 AND s.principal_id = $5
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [
      memoryId,
      storeId,
      principal.tenantId,
      principal.principalType,
      principal.principalId,
    ],
  );
  return result.rows?.[0] ?? null;
}

function isMemoryPathConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint === 'memories_store_path_key'
  );
}
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
function mapStore(row: StoreRow): MemoryStore {
  return {
    id: row.id,
    owner: {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
    },
    name: row.name,
    description: row.description,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapMemory(row: MemoryRow): Memory {
  const current: MemoryVersion = {
    id: row.memory_version_id,
    memoryId: row.memory_id,
    version: row.version,
    content: row.content,
    contentSha256: row.content_sha256,
    contentSizeBytes: row.content_size_bytes,
    operation: row.operation,
    previousVersionId: row.previous_version_id,
    createdAt: iso(row.version_created_at),
  };
  return {
    id: row.memory_id,
    storeId: row.memory_store_id,
    path: row.path,
    current,
    createdAt: iso(row.memory_created_at),
    updatedAt: iso(row.memory_updated_at),
  };
}
