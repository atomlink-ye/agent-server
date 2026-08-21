import { randomUUID } from 'node:crypto';

import type {
  LogicalFileEntry,
  LogicalFileStore,
} from '../../application/ports/logical-file-store.js';
import {
  contextScopeKind,
  contextScopeStorageKey,
  contextScopeTenantId,
  type ContextScope,
} from '../../domain/context/context-fs.js';
import {
  contentSizeBytes,
  normalizeAgentHomePath,
  sha256,
  validateAgentHomeContent,
} from '../../domain/agents/agent-home.js';

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

type EntryRow = {
  id: string;
  tenant_id: string;
  scope_kind: ContextScope['kind'];
  scope_key: string;
  path: string;
  current_version: number;
  content: string;
  content_sha256: string;
  content_size_bytes: number;
  created_at: string | Date;
  updated_at: string | Date;
};

const ENTRY_COLUMNS =
  'id,tenant_id,scope_kind,scope_key,path,current_version,content,content_sha256,content_size_bytes,created_at,updated_at';

export class PostgresLogicalFileStore implements LogicalFileStore {
  public constructor(private readonly database: Database) {}

  public async list(scope: ContextScope): Promise<readonly LogicalFileEntry[]> {
    const result = await this.database.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM context_entries
       WHERE tenant_id=$1 AND scope_kind=$2 AND scope_key=$3
       ORDER BY path`,
      [
        contextScopeTenantId(scope),
        contextScopeKind(scope),
        contextScopeStorageKey(scope),
      ],
    );
    return (result.rows ?? []).map((row) => mapEntry(row, scope));
  }

  public async read(
    scope: ContextScope,
    path: string,
  ): Promise<LogicalFileEntry | null> {
    const normalizedPath = normalizeAgentHomePath(path);
    const result = await this.database.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM context_entries
       WHERE tenant_id=$1 AND scope_kind=$2 AND scope_key=$3 AND path=$4`,
      [
        contextScopeTenantId(scope),
        contextScopeKind(scope),
        contextScopeStorageKey(scope),
        normalizedPath,
      ],
    );
    return result.rows?.[0] ? mapEntry(result.rows[0], scope) : null;
  }

  public async write(input: {
    readonly scope: ContextScope;
    readonly path: string;
    readonly content: string;
  }): Promise<LogicalFileEntry> {
    const path = normalizeAgentHomePath(input.path);
    const content = validateAgentHomeContent(input.content);
    const digest = sha256(content);
    const size = contentSizeBytes(content);
    const client = await this.client();
    const tenantId = contextScopeTenantId(input.scope);
    const scopeKind = contextScopeKind(input.scope);
    const scopeKey = contextScopeStorageKey(input.scope);
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      const existingResult = await client.query<{
        id: string;
        current_version: number;
      }>(
        `SELECT id,current_version FROM context_entries
         WHERE tenant_id=$1 AND scope_kind=$2 AND scope_key=$3 AND path=$4
         FOR UPDATE`,
        [tenantId, scopeKind, scopeKey, path],
      );
      const existing = existingResult.rows?.[0];
      const entryId = existing?.id ?? randomUUID();
      const nextVersion = (existing?.current_version ?? 0) + 1;
      if (existing) {
        await client.query(
          `UPDATE context_entries
              SET content=$1,content_sha256=$2,content_size_bytes=$3,
                  current_version=$4,updated_at=$5
            WHERE id=$6`,
          [content, digest, size, nextVersion, now, entryId],
        );
      } else {
        await client.query(
          `INSERT INTO context_entries
           (id,tenant_id,scope_kind,scope_key,path,current_version,content,
            content_sha256,content_size_bytes,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [
            entryId,
            tenantId,
            scopeKind,
            scopeKey,
            path,
            nextVersion,
            content,
            digest,
            size,
            now,
          ],
        );
      }
      await client.query(
        `INSERT INTO context_entry_snapshots
         (id,entry_id,version,content,content_sha256,content_size_bytes,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), entryId, nextVersion, content, digest, size, now],
      );
      const result = await client.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM context_entries WHERE id=$1`,
        [entryId],
      );
      const row = result.rows?.[0];
      if (!row) throw new Error('Context entry disappeared after write.');
      await client.query('COMMIT');
      return mapEntry(row, input.scope);
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

function mapEntry(row: EntryRow, scope: ContextScope): LogicalFileEntry {
  return Object.freeze({
    id: row.id,
    scope,
    path: row.path,
    currentVersion: row.current_version,
    content: row.content,
    contentSha256: row.content_sha256,
    contentSizeBytes: row.content_size_bytes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
