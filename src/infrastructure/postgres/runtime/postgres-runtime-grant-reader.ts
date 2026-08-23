import type { RuntimeGrantReader, RuntimeGrantRecord } from '../../../application/ports/runtime-grant-reader.js';
import type { RuntimeGrantId } from '../../../domain/runtime/runtime-session.js';

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

interface GrantRow extends Record<string, unknown> {
  readonly id: string;
  readonly runtime_session_id: string;
  readonly generation_id: string;
  readonly runtime_turn_id: string | null;
  readonly token_hash: string;
  readonly catalog_digest: string;
  readonly allowed_tools: unknown;
  readonly expires_at: string | Date;
  readonly revoked_at: string | Date | null;
}

const COLUMNS = `id,runtime_session_id,generation_id,runtime_turn_id,token_hash,
  catalog_digest,allowed_tools,expires_at,revoked_at`;

/** PostgreSQL read side for the exact 0056 runtime_tool_grants shape. */
export class PostgresRuntimeGrantReader implements RuntimeGrantReader {
  public constructor(private readonly database: Queryable) {}

  public async findByTokenHash(tokenHash: string): Promise<RuntimeGrantRecord | null> {
    const result = await this.database.query<GrantRow>(
      `SELECT ${COLUMNS} FROM runtime_tool_grants WHERE token_hash=$1`,
      [tokenHash],
    );
    return result.rows?.[0] ? mapGrant(result.rows[0]) : null;
  }

  public async findById(id: RuntimeGrantId): Promise<RuntimeGrantRecord | null> {
    const result = await this.database.query<GrantRow>(
      `SELECT ${COLUMNS} FROM runtime_tool_grants WHERE id=$1`,
      [id],
    );
    return result.rows?.[0] ? mapGrant(result.rows[0]) : null;
  }
}

function mapGrant(row: GrantRow): RuntimeGrantRecord {
  return Object.freeze({
    id: row.id as RuntimeGrantId,
    runtimeSessionId: row.runtime_session_id as RuntimeGrantRecord['runtimeSessionId'],
    generationId: row.generation_id as RuntimeGrantRecord['generationId'],
    runtimeTurnId: row.runtime_turn_id as RuntimeGrantRecord['runtimeTurnId'],
    tokenHash: row.token_hash,
    catalogDigest: row.catalog_digest,
    allowedTools: Object.freeze(readStrings(row.allowed_tools)),
    expiresAt: iso(row.expires_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
  });
}

function readStrings(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string'))
    throw new Error('Persisted runtime grant tool set is invalid.');
  return [...parsed];
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
