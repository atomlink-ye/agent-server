import type {
  ExecutionEventFact,
  ExecutionFactOwnerScope,
  ExecutionFactQuery,
  ExecutionRunFact,
} from '../../application/ports/execution-fact-query.js';
import { ExecutionFactQueryError } from '../../application/ports/execution-fact-query.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface RunRow {
  run_id: string;
  task_id: string;
  root_task_id: string;
  status: ExecutionRunFact['status'];
  provider: string | null;
  model: string | null;
  result_present: boolean;
  error_code: string | null;
  actor_id: string | null;
  work_item_id: string | null;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface EventRow {
  id: string;
  run_id: string;
  sequence: number | string;
  type: ExecutionEventFact['type'];
  payload_present: boolean;
  task_id: string;
  root_task_id: string;
  actor_id: string | null;
  work_item_id: string | null;
  activity_id: string | null;
  activity_kind: 'tool_status' | 'permission' | null;
  activity_category: string | null;
  activity_status: string | null;
  tool_name: string | null;
  provenance: string | null;
  tool_identity_capture_status: string | null;
  response_observed: boolean | null;
  created_at: string | Date;
}

export interface PostgresExecutionFactQueryOptions {
  readonly eventPageSize?: number;
  readonly maxEventPagesPerRun?: number;
}

export class PostgresExecutionFactQuery implements ExecutionFactQuery {
  readonly #eventPageSize: number;
  readonly #maxEventPagesPerRun: number;

  public constructor(
    private readonly database: Queryable,
    options: PostgresExecutionFactQueryOptions = {},
  ) {
    this.#eventPageSize = positiveInteger(
      options.eventPageSize ?? 100,
      'eventPageSize',
    );
    this.#maxEventPagesPerRun = positiveInteger(
      options.maxEventPagesPerRun ?? 1_000,
      'maxEventPagesPerRun',
    );
  }

  public async listRunsByRootTask(
    input: ExecutionFactOwnerScope & { readonly rootTaskId: string },
  ): Promise<readonly ExecutionRunFact[]> {
    const result = await this.database.query<RunRow>(
      `SELECT r.id AS run_id,r.task_id,t.root_task_id,r.status,
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
              r.created_at,r.updated_at
         FROM runs r
         JOIN tasks t ON t.id=r.task_id
         JOIN team_runs tr ON tr.root_task_id=t.root_task_id
                           AND tr.tenant_id=$2 AND tr.workspace_id=$3
         LEFT JOIN team_work_item_attempts attempt
                ON attempt.execution_task_id=t.id
               AND attempt.team_run_id=tr.id
               AND attempt.tenant_id=$2 AND attempt.workspace_id=$3
        WHERE t.root_task_id=$1 AND t.tenant_id=$2 AND t.workspace_id=$3
        ORDER BY r.created_at,r.id`,
      [input.rootTaskId, input.tenantId, input.workspaceId],
    );
    return (result.rows ?? []).map((row) => ({
      runId: row.run_id,
      taskId: row.task_id,
      rootTaskId: row.root_task_id,
      status: row.status,
      provider: row.provider ?? null,
      model: row.model ?? null,
      resultPresent: row.result_present ?? false,
      errorCode: row.error_code ?? null,
      actorId: row.actor_id ?? null,
      workItemId: row.work_item_id ?? null,
      startedAt: row.started_at ? toIso(row.started_at) : null,
      endedAt: row.ended_at ? toIso(row.ended_at) : null,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));
  }

  public async listRunEvents(
    input: ExecutionFactOwnerScope & { readonly runIds: readonly string[] },
  ): Promise<readonly ExecutionEventFact[]> {
    if (input.runIds.length === 0) return [];
    const events: ExecutionEventFact[] = [];
    for (const runId of [...new Set(input.runIds)].sort()) {
      let after = 0;
      let pagesRead = 0;
      while (true) {
        const result = await this.database.query<EventRow>(
          `SELECT e.id,e.run_id,e.sequence,e.type,
                  (e.payload <> '{}'::jsonb) AS payload_present,
                  t.id AS task_id,t.root_task_id,
                  t.team_member_run_id AS actor_id,
                  attempt.work_item_id AS work_item_id,
                  e.payload->>'activity_id' AS activity_id,
                  CASE WHEN e.payload->>'kind' IN ('tool_status','permission')
                       THEN e.payload->>'kind' ELSE NULL END AS activity_kind,
                  e.payload->>'category' AS activity_category,
                  e.payload->>'status' AS activity_status,
                  CASE WHEN e.payload->>'kind'='tool_status'
                       AND e.payload->>'provenance'='server_authorized_team_mcp_catalog'
                       AND e.payload->>'tool_identity_capture_status'='present'
                       THEN e.payload->>'tool_name' ELSE NULL END AS tool_name,
                  CASE WHEN e.payload->>'kind'='tool_status'
                       AND e.payload->>'provenance'='server_authorized_team_mcp_catalog'
                       AND e.payload->>'tool_identity_capture_status'='present'
                       THEN e.payload->>'provenance' ELSE NULL END AS provenance,
                  CASE WHEN e.payload->>'kind'='tool_status'
                       AND e.payload->>'provenance'='server_authorized_team_mcp_catalog'
                       AND e.payload->>'tool_identity_capture_status'='present'
                       THEN e.payload->>'tool_identity_capture_status' ELSE NULL END
                       AS tool_identity_capture_status,
                  CASE WHEN e.payload->>'kind'='tool_status'
                       AND e.payload->>'provenance'='server_authorized_team_mcp_catalog'
                       AND e.payload->>'tool_identity_capture_status'='present'
                       AND e.payload->>'response_observed' IN ('true','false')
                       THEN (e.payload->>'response_observed')::boolean ELSE NULL END
                       AS response_observed,
                  e.created_at
             FROM run_events e
             JOIN runs r ON r.id=e.run_id
             JOIN tasks t ON t.id=r.task_id
             JOIN team_runs tr ON tr.root_task_id=t.root_task_id
                               AND tr.tenant_id=$2 AND tr.workspace_id=$3
             LEFT JOIN team_work_item_attempts attempt
                    ON attempt.execution_task_id=t.id
                   AND attempt.team_run_id=tr.id
                   AND attempt.tenant_id=$2 AND attempt.workspace_id=$3
            WHERE e.run_id=$1 AND e.sequence>$4
              AND t.tenant_id=$2 AND t.workspace_id=$3
            ORDER BY e.sequence
            LIMIT $5`,
          [
            runId,
            input.tenantId,
            input.workspaceId,
            after,
            this.#eventPageSize,
          ],
        );
        const rows = result.rows ?? [];
        if (rows.length === 0) break;
        pagesRead += 1;
        if (pagesRead > this.#maxEventPagesPerRun)
          throw new ExecutionFactQueryError('event_page_limit');
        for (const row of rows) {
          const sequence = Number(row.sequence);
          if (
            row.run_id !== runId ||
            !Number.isSafeInteger(sequence) ||
            sequence <= after
          )
            throw new ExecutionFactQueryError('event_page_order_invalid');
          events.push({
            id: row.id,
            runId: row.run_id,
            sequence,
            type: row.type,
            payloadPresent: row.payload_present ?? false,
            taskId: row.task_id,
            rootTaskId: row.root_task_id,
            actorId: row.actor_id ?? null,
            workItemId: row.work_item_id ?? null,
            activityId: row.activity_id ?? null,
            activityKind: row.activity_kind ?? null,
            activityCategory: row.activity_category ?? null,
            activityStatus: row.activity_status ?? null,
            toolName: row.tool_name ?? null,
            provenance: row.provenance ?? null,
            toolIdentityCaptureStatus: row.tool_identity_capture_status ?? null,
            responseObserved: row.response_observed ?? null,
            createdAt: toIso(row.created_at),
          });
          after = sequence;
        }
        if (rows.length < this.#eventPageSize) break;
      }
    }
    return events.sort(compareExecutionEvents);
  }
}

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function compareExecutionEvents(
  left: ExecutionEventFact,
  right: ExecutionEventFact,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.runId.localeCompare(right.runId) ||
    left.sequence - right.sequence
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}
