import type {
  ExecutionEventFact,
  ExecutionFactOwnerScope,
  ExecutionFactQuery,
  ExecutionRunFact,
} from '../../application/ports/execution-fact-query.js';

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
  created_at: string | Date;
  updated_at: string | Date;
}

interface EventRow {
  id: string;
  run_id: string;
  sequence: number | string;
  type: ExecutionEventFact['type'];
  payload_present: boolean;
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
              r.created_at,r.updated_at
         FROM runs r
         JOIN tasks t ON t.id=r.task_id
         JOIN team_runs tr ON tr.root_task_id=t.root_task_id
                           AND tr.tenant_id=$2 AND tr.workspace_id=$3
        WHERE t.root_task_id=$1
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
                  (e.payload <> '{}'::jsonb) AS payload_present,e.created_at
             FROM run_events e
             JOIN runs r ON r.id=e.run_id
             JOIN tasks t ON t.id=r.task_id
             JOIN team_runs tr ON tr.root_task_id=t.root_task_id
                               AND tr.tenant_id=$2 AND tr.workspace_id=$3
            WHERE e.run_id=$1 AND e.sequence>$4
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
          throw new Error('execution_event_page_limit_exceeded');
        for (const row of rows) {
          const sequence = Number(row.sequence);
          if (
            row.run_id !== runId ||
            !Number.isSafeInteger(sequence) ||
            sequence <= after
          )
            throw new Error('execution_event_page_order_invalid');
          events.push({
            id: row.id,
            runId: row.run_id,
            sequence,
            type: row.type,
            payloadPresent: row.payload_present ?? false,
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
