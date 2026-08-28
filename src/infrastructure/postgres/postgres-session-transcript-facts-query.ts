import type { ExecutionRunFact } from '../../application/ports/execution-fact-query.js';
import type {
  AgentActivityStreamFact,
  ProductSessionTranscriptFactsQuery,
} from '../../application/product-projection/session-transcript-facts-source.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

interface Row {
  activity_key: string;
  name: string;
  role: string | null;
  member_status: string | null;
  team_member_run_id: string | null;
  ref_task_id: string | null;
  run_id: string | null;
  run_task_id: string | null;
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
 * Loads every agent identity that was active under a root task and the
 * durable Tasks/Runs it produced. "An agent was active" is the display unit
 * — Team membership is optional extra structure, not a precondition — so the
 * identity key is COALESCE(team_member_run_id, task_id), never
 * runtime_session_id: a RuntimeSession's scope for a lone agent is
 * {kind:'run', id: run.id} (agent-run-executor.ts), so keying on it would
 * split one retried agent into two streams.
 *
 * Two branches feed the identity:
 *  - activity-derived (every shape): a Task actually produced a Run.
 *  - roster-derived (Team only): a TeamMember exists with no Task yet, so it
 *    would otherwise vanish from the nav while a role is still spinning up.
 *
 * It deliberately returns no provider/session identifiers that could be
 * serialized by the projector.
 */
export class PostgresSessionTranscriptFactsQuery implements ProductSessionTranscriptFactsQuery {
  public constructor(private readonly database: Queryable) {}

  public async listByRootTask(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly rootTaskId: string;
  }): Promise<readonly AgentActivityStreamFact[]> {
    const result = await this.database.query<Row>(
      `SELECT activity_key,name,role,member_status,team_member_run_id,ref_task_id,
              run_id,run_task_id,run_root_task_id,run_status,provider,model,
              result_present,error_code,actor_id,work_item_id,started_at,ended_at,
              run_created_at,run_updated_at
         FROM (
           SELECT
             COALESCE(t.team_member_run_id,t.id) AS activity_key,
             COALESCE(m.name,av.name,wv.name) AS name,
             m.role AS role,
             m.status AS member_status,
             t.team_member_run_id AS team_member_run_id,
             t.id AS ref_task_id,
             COALESCE(m.created_at,t.created_at) AS order_basis,
             r.id AS run_id,
             r.task_id AS run_task_id,
             t.root_task_id AS run_root_task_id,
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
             r.created_at AS run_created_at,
             r.updated_at AS run_updated_at
           FROM tasks t
           JOIN runs r
             ON r.task_id=t.id
           LEFT JOIN team_member_runs m
             ON m.id=t.team_member_run_id
            AND m.tenant_id=$2 AND m.workspace_id=$3
           -- agent_versions.id is uuid while tasks.invokable_version_id is text
           -- (it also carries the non-uuid-shaped Run-API compatibility
           -- sentinel), so cast the uuid side. Casting the text side raises
           -- "invalid input syntax for type uuid", the same class of 500 this
           -- file already had to fix once for team_member_runs/runtime_sessions.
           LEFT JOIN agent_versions av
             ON av.id::text=t.invokable_version_id
            AND av.tenant_id=$2 AND av.workspace_id=$3
           -- Since the Coworker/Worker split, a Team's child Tasks pin a
           -- WorkerVersion, so the agent_versions join above resolves to NULL
           -- for them and the name has to come from here instead.
           LEFT JOIN worker_versions wv
             ON wv.id::text=t.invokable_version_id
            AND wv.tenant_id=$2 AND wv.workspace_id=$3
           LEFT JOIN team_work_item_attempts attempt
             ON attempt.execution_task_id=t.id
            AND attempt.tenant_id=$2 AND attempt.workspace_id=$3
          WHERE t.root_task_id=$1
            AND t.tenant_id=$2 AND t.workspace_id=$3
            -- "An agent was active" is the display unit. A Team's own
            -- coordinator Task (invokable_kind='team', e.g. the TeamRun's
            -- root Task) is control-plane orchestration, not an agent turn,
            -- and never had a stream under the old team_member_runs-rooted
            -- query either; keep it out of the activity-derived branch.
            --
            -- 'worker' has to be admitted alongside 'agent': this filter was
            -- written before the Coworker/Worker split, when every executing
            -- Task was an Agent. After the split a Team's children are Workers,
            -- so an 'agent'-only filter matched nothing and the endpoint
            -- answered 200 with an empty sessions array — a Work whose
            -- Transcript was blank in the UI while its trace held tens of
            -- thousands of bytes of recorded activity.
            AND t.invokable_kind IN ('agent','worker')

          UNION ALL

           SELECT
             m.id AS activity_key,
             m.name AS name,
             m.role AS role,
             m.status AS member_status,
             m.id AS team_member_run_id,
             NULL::uuid AS ref_task_id,
             m.created_at AS order_basis,
             NULL::uuid AS run_id,
             NULL::uuid AS run_task_id,
             NULL::uuid AS run_root_task_id,
             NULL::text AS run_status,
             NULL::text AS provider,
             NULL::text AS model,
             NULL::boolean AS result_present,
             NULL::text AS error_code,
             NULL::uuid AS actor_id,
             NULL::uuid AS work_item_id,
             NULL::timestamptz AS started_at,
             NULL::timestamptz AS ended_at,
             NULL::timestamptz AS run_created_at,
             NULL::timestamptz AS run_updated_at
           FROM team_runs tr
           JOIN team_member_runs m
             ON m.team_run_id=tr.id
            AND m.tenant_id=$2 AND m.workspace_id=$3
          WHERE tr.root_task_id=$1
            AND tr.tenant_id=$2 AND tr.workspace_id=$3
            AND NOT EXISTS (
              SELECT 1 FROM tasks t2
               WHERE t2.team_member_run_id=m.id
                 AND t2.root_task_id=tr.root_task_id
            )
         ) stream_rows
        ORDER BY order_basis NULLS LAST,activity_key,run_created_at,run_id`,
      [input.rootTaskId, input.tenantId, input.workspaceId],
    );

    const grouped = new Map<string, AgentActivityStreamFact>();
    for (const row of result.rows ?? []) {
      const statusBasis: AgentActivityStreamFact['statusBasis'] =
        row.member_status !== null ? 'team_member_run' : 'agent_runs';
      const status = row.member_status ?? row.run_status ?? 'unknown';
      const current: AgentActivityStreamFact = {
        name: row.name,
        role: row.role,
        status,
        statusBasis,
        sourceRefs: row.team_member_run_id
          ? { teamMemberRunId: row.team_member_run_id }
          : row.ref_task_id
            ? { taskId: row.ref_task_id }
            : {},
        runs: grouped.get(row.activity_key)?.runs ?? [],
      };
      if (
        row.run_id &&
        row.run_task_id &&
        row.run_root_task_id &&
        row.run_status
      ) {
        const run: ExecutionRunFact = {
          runId: row.run_id,
          taskId: row.run_task_id,
          rootTaskId: row.run_root_task_id,
          status: row.run_status,
          provider: row.provider ?? null,
          model: row.model ?? null,
          resultPresent: row.result_present ?? false,
          resultText: null,
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
      grouped.set(row.activity_key, current);
    }
    return [...grouped.values()];
  }
}

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
