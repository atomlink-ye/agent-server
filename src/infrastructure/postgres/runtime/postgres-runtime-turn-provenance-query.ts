import type { RuntimeTurnProvenanceQuery } from '../../../application/ports/runtime-turn-provenance-query.js';
import type {
  RuntimeSessionId,
  RuntimeTurnId,
} from '../../../domain/runtime/runtime-session.js';
import type {
  RuntimeFailureCode,
  RuntimeTurn,
  RuntimeTurnSource,
  RuntimeTurnStatus,
} from '../../../domain/runtime/runtime-turn.js';

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

interface ProvenanceRow extends Record<string, unknown> {
  readonly turn_id: string;
  readonly runtime_session_id: string;
}

interface ActiveTurnRow extends Record<string, unknown> {
  readonly id: string;
  readonly runtime_session_id: string;
  readonly generation_id: string | null;
  readonly source_kind: string;
  readonly source_id: string;
  readonly source_context: unknown;
  readonly status: RuntimeTurnStatus;
  readonly prompt_digest: string | null;
  readonly failure_code: RuntimeFailureCode | null;
  readonly created_at: string | Date;
  readonly started_at: string | Date | null;
  readonly completed_at: string | Date | null;
}

export class PostgresRuntimeTurnProvenanceQuery implements RuntimeTurnProvenanceQuery {
  public constructor(private readonly database: Queryable) {}

  public async findActiveRunTurn(runId: string): Promise<RuntimeTurn | null> {
    const result = await this.database.query<ActiveTurnRow>(
      `SELECT rt.id,rt.runtime_session_id,rt.generation_id,
              rt.source_kind,rt.source_id,rt.source_context,rt.status,
              rt.prompt_digest,rt.failure_code,rt.created_at,
              rt.started_at,rt.completed_at
         FROM runtime_turns rt
        WHERE rt.status IN ('pending','preparing','running')
          AND rt.source_kind='run'
          AND rt.source_id=$1
        LIMIT 2`,
      [runId],
    );
    const rows = result.rows ?? [];
    if (rows.length > 1) throw new Error('runtime_active_turn_ambiguous');
    return rows[0] ? mapActiveTurn(rows[0]) : null;
  }

  public async findSucceededRunTurn(input: {
    readonly runId: string;
    readonly productSessionId: string;
  }): Promise<{
    readonly turnId: RuntimeTurnId;
    readonly runtimeSessionId: RuntimeSessionId;
  } | null> {
    const result = await this.database.query<ProvenanceRow>(
      `SELECT rt.id AS turn_id,rt.runtime_session_id
         FROM runtime_turns rt
         JOIN runtime_sessions rs
           ON rs.id=rt.runtime_session_id
         JOIN runtime_session_generations rsg
           ON rsg.id=rt.generation_id
          AND rsg.runtime_session_id=rt.runtime_session_id
        WHERE rs.scope_kind='product_session'
          AND rs.scope_id=$2
          AND rt.status='succeeded'
          AND rt.source_kind='run'
          AND rt.source_id=$1
        ORDER BY rt.completed_at DESC,rt.id DESC
        LIMIT 1`,
      [input.runId, input.productSessionId],
    );
    const row = result.rows?.[0];
    return row
      ? {
          turnId: row.turn_id as RuntimeTurnId,
          runtimeSessionId: row.runtime_session_id as RuntimeSessionId,
        }
      : null;
  }
}

function mapActiveTurn(row: ActiveTurnRow): RuntimeTurn {
  return Object.freeze({
    id: row.id as RuntimeTurnId,
    runtimeSessionId: row.runtime_session_id as RuntimeSessionId,
    generationId: row.generation_id as RuntimeTurn['generationId'],
    source: decodeSource(row),
    status: row.status,
    promptDigest: row.prompt_digest,
    failureCode: row.failure_code,
    createdAt: iso(row.created_at),
    startedAt: row.started_at === null ? null : iso(row.started_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
  });
}

function decodeSource(row: ActiveTurnRow): RuntimeTurnSource {
  const context = objectContext(row.source_context);
  if (row.source_kind === 'run') {
    if (Object.keys(context).length !== 0)
      throw new Error('Runtime run turn source is invalid.');
    return { kind: 'run', runId: row.source_id };
  }
  throw new Error('Runtime turn source is invalid.');
}

function objectContext(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Runtime turn source context is invalid.');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, entry]) => typeof entry !== 'string'))
    throw new Error('Runtime turn source context is invalid.');
  return Object.fromEntries(entries) as Record<string, string>;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
