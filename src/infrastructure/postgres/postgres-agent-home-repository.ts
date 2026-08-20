import { randomUUID } from 'node:crypto';
import type {
  AgentHomeRepository,
  AgentHomeEntryRow,
  ListAgentHomeEntriesInput,
  ReadAgentHomeEntryInput,
  WriteAgentHomeEntryInput,
} from '../../application/ports/agent-home-repository.js';

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
  path: string;
  current_version: number;
  content: string;
  content_sha256: string;
  content_size_bytes: number;
  created_at: string | Date;
  updated_at: string | Date;
};

const ENTRY_COLUMNS =
  'id, path, current_version, content, content_sha256, content_size_bytes, created_at, updated_at';

export class PostgresAgentHomeRepository implements AgentHomeRepository {
  public constructor(private readonly database: Database) {}

  public async list(
    input: ListAgentHomeEntriesInput,
  ): Promise<readonly AgentHomeEntryRow[] | null> {
    const result = await this.database.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM agent_home_entries
       WHERE tenant_id = $1 AND agent_definition_id = $2 AND namespace = $3 AND scope_key = $4
       ORDER BY path`,
      [
        input.scope.tenantId,
        input.scope.agentDefinitionId,
        input.scope.namespace,
        input.scope.scopeKey,
      ],
    );
    return (result.rows ?? []).map(mapEntry);
  }

  public async read(
    input: ReadAgentHomeEntryInput,
  ): Promise<AgentHomeEntryRow | null> {
    const result = await this.database.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM agent_home_entries
       WHERE tenant_id = $1 AND agent_definition_id = $2 AND namespace = $3 AND scope_key = $4 AND path = $5`,
      [
        input.scope.tenantId,
        input.scope.agentDefinitionId,
        input.scope.namespace,
        input.scope.scopeKey,
        input.path,
      ],
    );
    return result.rows?.[0] ? mapEntry(result.rows[0]) : null;
  }

  public async write(
    input: WriteAgentHomeEntryInput,
  ): Promise<AgentHomeEntryRow | null> {
    const client = await this.client();
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      // Try to find existing entry
      const existingResult = await client.query<{
        id: string;
        current_version: number;
      }>(
        `SELECT id, current_version FROM agent_home_entries
         WHERE tenant_id = $1 AND agent_definition_id = $2 AND namespace = $3 AND scope_key = $4 AND path = $5
         FOR UPDATE`,
        [
          input.scope.tenantId,
          input.scope.agentDefinitionId,
          input.scope.namespace,
          input.scope.scopeKey,
          input.path,
        ],
      );

      const existing = existingResult.rows?.[0];
      const entryId = existing?.id ?? randomUUID();
      const nextVersion = (existing?.current_version ?? 0) + 1;

      if (existing) {
        // Update existing entry
        await client.query(
          `UPDATE agent_home_entries
           SET content = $1, content_sha256 = $2, content_size_bytes = $3,
               current_version = $4, updated_at = $5
           WHERE id = $6`,
          [
            input.content,
            input.contentSha256,
            input.contentSizeBytes,
            nextVersion,
            now,
            entryId,
          ],
        );
      } else {
        // Insert new entry
        await client.query(
          `INSERT INTO agent_home_entries
           (id, tenant_id, agent_definition_id, namespace, scope_key, path,
            current_version, content, content_sha256, content_size_bytes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [
            entryId,
            input.scope.tenantId,
            input.scope.agentDefinitionId,
            input.scope.namespace,
            input.scope.scopeKey,
            input.path,
            nextVersion,
            input.content,
            input.contentSha256,
            input.contentSizeBytes,
            now,
          ],
        );
      }

      // Create snapshot
      await client.query(
        `INSERT INTO agent_home_snapshots
         (id, entry_id, version, content, content_sha256, content_size_bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          entryId,
          nextVersion,
          input.content,
          input.contentSha256,
          input.contentSizeBytes,
          now,
        ],
      );

      // Fetch the updated entry
      const result = await client.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM agent_home_entries WHERE id = $1`,
        [entryId],
      );

      await client.query('COMMIT');
      return result.rows?.[0] ? mapEntry(result.rows[0]) : null;
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

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapEntry(row: EntryRow): AgentHomeEntryRow {
  return {
    id: row.id,
    path: row.path,
    currentVersion: row.current_version,
    content: row.content,
    contentSha256: row.content_sha256,
    contentSizeBytes: row.content_size_bytes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
