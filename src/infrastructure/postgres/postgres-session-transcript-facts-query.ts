import type { ExecutionRunFact } from '../../application/ports/execution-fact-query.js';
import type {
  ProductSessionTranscriptFactsQuery,
  ProductSessionTranscriptMemberFact,
} from '../../application/product-projection/session-transcript-facts-source.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

interface Row {
  member_id: string;
  name: string;
  role: string;
  member_status: string;
  runtime_session_id: string;
  run_id: string | null;
  task_id: string | null;
  run_root_task_id: string | null;
  run_status: ExecutionRunFact['status'] | null;
  provider: string | null;
  model: string | null;
  result_present: boolean | null;
  error_code: string | null;
  actor_id: string | null;
  work_item_id: string | null;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  run_created_at: string | Date | null;
  run_updated_at: string | Date | null;
}

/**
 * Loads the Product-owned path root task → team run → member → runtime session
 * and all durable Tasks/Runs owned by that member. It deliberately returns no
 * provider/session identifiers that could be serialized by the projector.
 */
export class PostgresSessionTranscriptFactsQuery implements ProductSessionTranscriptFactsQuery {
  public constructor(private readonly database: Queryable) {}

  public async listByRootTask(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly rootTaskId: string;
  }): Promise<readonly ProductSessionTranscriptMemberFact[]> {
    const result = await this.database.query<Row>(
      `SELECT m.id AS member_id,m.name,m.role,m.status AS member_status,
              rs.id AS runtime_session_id,
              r.id AS run_id,r.task_id,t.root_task_id AS run_root_task_id,
              r.status AS run_status,
              r.runtime->>'provider' AS provider,
              r.runtime->>'model' AS model,
              (r.result IS NOT NULL) AS result_present,
              r.error->>'code' AS error_code,
              t.team_member_run_id AS actor_id,
              attempt.work_item_id AS work_item_id,
              (SELECT MIN(se.created_at) FROM run_events se
                WHERE se.run_id=r.id AND se.type='started') AS started_at,
              (SELECT MAX(ee.created_at) FROM run_events ee
                WHERE ee.run_id=r.id
                  AND ee.type IN ('succeeded','failed','cancelled')) AS ended_at,
              r.created_at AS run_created_at,r.updated_at AS run_updated_at
         FROM team_runs tr
         JOIN team_member_runs m
           ON m.team_run_id=tr.id
          AND m.tenant_id=$2 AND m.workspace_id=$3
         JOIN runtime_sessions rs
           ON rs.id=m.runtime_session_id
          -- RuntimeSession.scope_id is text because a scope id is not always a
          -- uuid, while team_member_runs.id is. Comparing them directly raises
          -- "operator does not exist: text = uuid", which surfaced only as a
          -- 500 on the session-transcripts read.
          AND rs.scope_id=m.id::text
          AND rs.scope_kind='team_member'
          AND rs.tenant_id=$2
         LEFT JOIN tasks t
           ON t.team_member_run_id=m.id
          AND t.root_task_id=tr.root_task_id
          AND t.tenant_id=$2 AND t.workspace_id=$3
         LEFT JOIN runs r
           ON r.task_id=t.id
         LEFT JOIN team_work_item_attempts attempt
           ON attempt.execution_task_id=t.id
          AND attempt.tenant_id=$2 AND attempt.workspace_id=$3
        WHERE tr.root_task_id=$1
          AND tr.tenant_id=$2 AND tr.workspace_id=$3
        ORDER BY m.created_at,m.id,r.created_at,r.id`,
      [input.rootTaskId, input.tenantId, input.workspaceId],
    );

    const grouped = new Map<string, ProductSessionTranscriptMemberFact>();
    for (const row of result.rows ?? []) {
      const current = grouped.get(row.runtime_session_id) ?? {
        name: row.name,
        role: row.role,
        status: row.member_status,
        runtimeSessionId: row.runtime_session_id,
        runs: [],
      };
      if (row.run_id && row.task_id && row.run_root_task_id && row.run_status) {
        const run: ExecutionRunFact = {
          runId: row.run_id,
          taskId: row.task_id,
          rootTaskId: row.run_root_task_id,
          status: row.run_status,
          provider: row.provider ?? null,
          model: row.model ?? null,
          resultPresent: row.result_present ?? false,
          errorCode: row.error_code ?? null,
          actorId: row.actor_id ?? null,
          workItemId: row.work_item_id ?? null,
          startedAt: row.started_at ? toIso(row.started_at) : null,
          endedAt: row.ended_at ? toIso(row.ended_at) : null,
          createdAt: toIso(row.run_created_at!),
          updatedAt: toIso(row.run_updated_at!),
        };
        if (!current.runs.some((candidate) => candidate.runId === run.runId))
          (current.runs as ExecutionRunFact[]).push(run);
      }
      grouped.set(row.runtime_session_id, current);
    }
    return [...grouped.values()];
  }
}

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
