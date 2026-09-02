import type {
  WakeLoopGuardKey,
  WakeLoopGuardRepository,
  WakeLoopGuardState,
} from '../../application/work-organization/wake-loop-guard.js';

export interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

type CounterRow = { agent_wake_count: number | string };

/**
 * Durable per-WorkItem mutual-wake counter backing wake-loop-guard's hard cap.
 * A single upsert keeps the read-modify-write atomic under concurrent wakes,
 * so no transaction or row lock is needed.
 */
export class PostgresWakeLoopGuardRepository implements WakeLoopGuardRepository {
  public constructor(private readonly database: PostgresQueryable) {}

  public async observeWake(
    input: WakeLoopGuardKey & { readonly causedByHuman: boolean },
  ): Promise<WakeLoopGuardState> {
    const result = await this.database.query<CounterRow>(
      `INSERT INTO work_item_wake_loop_counters
         (tenant_id, workspace_id, work_item_id, agent_wake_count, updated_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN 0 ELSE 1 END, now())
       ON CONFLICT (tenant_id, workspace_id, work_item_id) DO UPDATE
       SET agent_wake_count = CASE WHEN $4
             THEN 0
             ELSE work_item_wake_loop_counters.agent_wake_count + 1
           END,
           updated_at = now()
       RETURNING agent_wake_count`,
      [
        input.tenantId,
        input.workspaceId,
        input.workItemId,
        input.causedByHuman,
      ],
    );
    const row = result.rows?.[0];
    return { agentWakeCount: Number(row?.agent_wake_count ?? 0) };
  }
}
