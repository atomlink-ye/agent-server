import type { RuntimeTurnProvenanceQuery } from '../../../application/ports/runtime-turn-provenance-query.js';
import type {
  RuntimeSessionId,
  RuntimeTurnId,
} from '../../../domain/runtime/runtime-session.js';

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

export class PostgresRuntimeTurnProvenanceQuery implements RuntimeTurnProvenanceQuery {
  public constructor(private readonly database: Queryable) {}

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
          AND (
            (rt.source_kind='run' AND rt.source_id=$1)
            OR (
              rt.source_kind='team_member'
              AND rt.source_context->>'runId'=$1
            )
          )
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
