import type { TaskRepository } from '../../application/ports/task-repository.js';
import type {
  TaskLatestRunSummary,
  TaskOwnerScope,
  TaskRecord,
} from '../../application/ports/task-repository.js';
import {
  rehydrateTask,
  type Task,
  type TaskSnapshot,
  type TaskTeamActivation,
} from '../../domain/tasks/task.js';

interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

export class PostgresTaskRepository implements TaskRepository {
  public constructor(private readonly database: PostgresQueryable) {}

  public async save(task: Task): Promise<void> {
    await this.database.query(
      `
        INSERT INTO tasks (
          id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          policy_snapshot_version,
          root_task_id,
          parent_task_id,
          parent_run_id,
          depth,
          logical_step_key,
          node_path,
          status,
          ingress,
          origin_ref,
          invokable_kind,
          invokable_version_id,
          input_snapshot_ref,
          input_fingerprint,
           memory_snapshot_id,
           memory_snapshot_hash,
           team_member_run_id,
           team_sequence,
           team_task_kind,
           source_team_message_id,
           input_team_message_ids,
           team_activation_materializer,
           team_activation_causes,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
        )
        ON CONFLICT (id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          workspace_id = EXCLUDED.workspace_id,
          principal_type = EXCLUDED.principal_type,
          principal_id = EXCLUDED.principal_id,
          policy_snapshot_version = EXCLUDED.policy_snapshot_version,
          root_task_id = EXCLUDED.root_task_id,
          parent_task_id = EXCLUDED.parent_task_id,
          parent_run_id = EXCLUDED.parent_run_id,
          depth = EXCLUDED.depth,
          logical_step_key = EXCLUDED.logical_step_key,
          node_path = EXCLUDED.node_path,
          status = EXCLUDED.status,
          ingress = EXCLUDED.ingress,
          origin_ref = EXCLUDED.origin_ref,
          invokable_kind = EXCLUDED.invokable_kind,
          invokable_version_id = EXCLUDED.invokable_version_id,
          input_snapshot_ref = EXCLUDED.input_snapshot_ref,
          input_fingerprint = EXCLUDED.input_fingerprint,
           memory_snapshot_id = EXCLUDED.memory_snapshot_id,
           memory_snapshot_hash = EXCLUDED.memory_snapshot_hash,
           team_member_run_id = EXCLUDED.team_member_run_id,
           team_sequence = EXCLUDED.team_sequence,
           team_task_kind = EXCLUDED.team_task_kind,
          source_team_message_id = COALESCE(
            tasks.source_team_message_id,
            EXCLUDED.source_team_message_id
          ),
          input_team_message_ids = CASE
            WHEN COALESCE(cardinality(tasks.input_team_message_ids), 0) > 0
              THEN tasks.input_team_message_ids
            ELSE EXCLUDED.input_team_message_ids
          END,
          team_activation_materializer = EXCLUDED.team_activation_materializer,
          team_activation_causes = EXCLUDED.team_activation_causes,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        task.id,
        task.tenantId,
        task.workspaceId,
        task.principalType,
        task.principalId,
        task.policySnapshotVersion,
        task.rootTaskId,
        task.parentTaskId,
        task.parentRunId,
        task.depth,
        task.logicalStepKey,
        task.nodePath,
        task.status,
        task.ingress,
        task.originRef,
        task.invokableKind,
        task.invokableVersionId,
        task.inputSnapshotRef,
        task.inputFingerprint,
        task.memorySnapshotId ?? null,
        task.memorySnapshotHash ?? null,
        task.teamMemberRunId ?? null,
        task.teamSequence ?? null,
        task.teamTaskKind ?? null,
        task.sourceTeamMessageId ?? null,
        task.inputTeamMessageIds ?? [],
        task.teamActivation?.materializer ?? null,
        task.teamActivation ? JSON.stringify(task.teamActivation.causes) : null,
        task.createdAt,
        task.updatedAt,
      ],
    );
  }

  public async findById(id: string): Promise<Task | null> {
    const result = await this.database.query<TaskRow>(
      `${TASK_SELECT_SQL}
        WHERE tasks.id = $1
      `,
      [id],
    );

    const row = result.rows?.[0];
    return row ? mapTaskRow(row).task : null;
  }

  public async findByIdForOwner(
    id: string,
    ownerScope: TaskOwnerScope,
  ): Promise<TaskRecord | null> {
    const result = await this.database.query<TaskRow>(
      `${TASK_SELECT_SQL}
        WHERE tasks.id = $1
          AND tasks.tenant_id = $2
          AND (tasks.workspace_id = $3 OR tasks.session_id IS NOT NULL)
          AND tasks.principal_type = $4
          AND tasks.principal_id = $5
      `,
      [
        id,
        ownerScope.tenantId,
        ownerScope.workspaceId,
        ownerScope.principalType,
        ownerScope.principalId,
      ],
    );

    const row = result.rows?.[0];
    return row ? mapTaskRow(row) : null;
  }

  public async findByRootTaskIdForOwner(
    rootTaskId: string,
    ownerScope: TaskOwnerScope,
  ): Promise<readonly TaskRecord[]> {
    const result = await this.database.query<TaskRow>(
      `${TASK_SELECT_SQL}
        WHERE tasks.root_task_id = $1
          AND tasks.tenant_id = $2
          AND (tasks.workspace_id = $3 OR tasks.session_id IS NOT NULL)
          AND tasks.principal_type = $4
          AND tasks.principal_id = $5
        ORDER BY tasks.depth ASC, tasks.node_path ASC NULLS FIRST, tasks.created_at ASC, tasks.id ASC
      `,
      [
        rootTaskId,
        ownerScope.tenantId,
        ownerScope.workspaceId,
        ownerScope.principalType,
        ownerScope.principalId,
      ],
    );

    return (result.rows ?? []).map(mapTaskRow);
  }

  public async advanceSessionLane(taskId: string): Promise<void> {
    await this.database.query(
      `
        WITH next_task AS (
          SELECT queued.id
          FROM session_lanes lane
          JOIN tasks current_task ON current_task.id = lane.active_task_id
          JOIN tasks queued ON queued.session_id = current_task.session_id
            AND queued.generation = lane.generation
            AND queued.status = 'queued'
          WHERE lane.active_task_id = $1
          ORDER BY queued.generation ASC, queued.lane_sequence ASC, queued.created_at ASC
          LIMIT 1
        )
        UPDATE session_lanes
        SET active_task_id = (SELECT id FROM next_task),
            active_cancellation_requested = false
        WHERE active_task_id = $1
      `,
      [taskId],
    );
  }
  public async requestCancellation(
    taskId: string,
    requestedAt: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE runs SET cancellation_requested=true,cancellation_requested_at=$2 WHERE task_id=$1 AND status IN ('queued','running')`,
      [taskId, requestedAt],
    );
  }
}

interface TaskRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly policy_snapshot_version: string;
  readonly root_task_id: string;
  readonly parent_task_id: string | null;
  readonly parent_run_id: string | null;
  readonly depth: number;
  readonly logical_step_key: string | null;
  readonly node_path: string | null;
  readonly status: Task['status'];
  readonly ingress: Task['ingress'];
  readonly origin_ref: string | null;
  readonly invokable_kind: Task['invokableKind'];
  readonly invokable_version_id: string;
  readonly input_snapshot_ref: string;
  readonly input_fingerprint: string;
  readonly memory_snapshot_id: string | null;
  readonly memory_snapshot_hash: string | null;
  readonly team_member_run_id: string | null;
  readonly team_sequence: number | null;
  readonly team_task_kind:
    'lead_turn' | 'work_attempt' | 'direct_message' | null;
  readonly source_team_message_id: string | null;
  readonly input_team_message_ids: readonly string[] | null;
  readonly team_activation_materializer:
    'task_run_collaboration_activation_adapter' | null;
  readonly team_activation_causes: readonly unknown[] | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly session_id: string | null;
  readonly input_message_id: string | null;
  readonly generation: number | null;
  readonly lane_sequence: number | null;
  readonly latest_run_id: string | null;
  readonly latest_run_attempt: number | null;
  readonly latest_run_status: TaskLatestRunSummary['status'] | null;
  readonly latest_run_runtime: Record<string, unknown> | null;
  readonly latest_run_result: Record<string, unknown> | null;
  readonly latest_run_error: Record<string, unknown> | null;
  readonly latest_run_created_at: string | Date | null;
  readonly latest_run_updated_at: string | Date | null;
}

const TASK_SELECT_SQL = `
  SELECT
    tasks.id,
    tasks.tenant_id,
    tasks.workspace_id,
    tasks.principal_type,
    tasks.principal_id,
    tasks.policy_snapshot_version,
    tasks.root_task_id,
    tasks.parent_task_id,
    tasks.parent_run_id,
    tasks.depth,
    tasks.logical_step_key,
    tasks.node_path,
    tasks.status,
    tasks.ingress,
    tasks.origin_ref,
    tasks.invokable_kind,
    tasks.invokable_version_id,
    tasks.input_snapshot_ref,
    tasks.input_fingerprint,
    tasks.memory_snapshot_id,
    tasks.memory_snapshot_hash,
    tasks.team_member_run_id,
    tasks.team_sequence,
    tasks.team_task_kind,
    tasks.source_team_message_id,
    tasks.input_team_message_ids,
    tasks.team_activation_materializer,
    tasks.team_activation_causes,
    tasks.created_at,
    tasks.updated_at,
    tasks.session_id,
    input_message.id AS input_message_id,
    tasks.generation,
    tasks.lane_sequence,
    latest_run.id AS latest_run_id,
    latest_run.attempt AS latest_run_attempt,
    latest_run.status AS latest_run_status,
    latest_run.runtime AS latest_run_runtime,
    latest_run.result AS latest_run_result,
    latest_run.error AS latest_run_error,
    latest_run.created_at AS latest_run_created_at,
    latest_run.updated_at AS latest_run_updated_at
  FROM tasks
  LEFT JOIN LATERAL (
    SELECT
      runs.id,
      runs.attempt,
      runs.status,
      runs.runtime,
      runs.result,
      runs.error,
      runs.created_at,
      runs.updated_at
    FROM runs
    WHERE runs.task_id = tasks.id
    ORDER BY runs.attempt DESC
    LIMIT 1
  ) AS latest_run ON TRUE
  LEFT JOIN LATERAL (
    SELECT messages.id
    FROM messages
    WHERE messages.task_id = tasks.id AND messages.role = 'user'
    ORDER BY messages.created_at ASC, messages.sequence ASC
    LIMIT 1
  ) AS input_message ON TRUE
`;

function mapTaskRow(row: TaskRow): TaskRecord {
  const taskSnapshot: TaskSnapshot = {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    policySnapshotVersion: row.policy_snapshot_version,
    rootTaskId: row.root_task_id,
    parentTaskId: row.parent_task_id,
    parentRunId: row.parent_run_id,
    depth: row.depth,
    logicalStepKey: row.logical_step_key,
    nodePath: row.node_path,
    status: row.status,
    ingress: row.ingress,
    originRef: row.origin_ref,
    invokableKind: row.invokable_kind,
    invokableVersionId: row.invokable_version_id,
    inputSnapshotRef: row.input_snapshot_ref,
    inputFingerprint: row.input_fingerprint,
    memorySnapshotId: row.memory_snapshot_id,
    memorySnapshotHash: row.memory_snapshot_hash,
    teamMemberRunId: row.team_member_run_id,
    teamSequence: row.team_sequence === null ? null : Number(row.team_sequence),
    teamTaskKind: row.team_task_kind,
    sourceTeamMessageId: row.source_team_message_id,
    inputTeamMessageIds: row.input_team_message_ids ?? [],
    teamActivation:
      row.team_activation_materializer && row.team_activation_causes
        ? {
            materializer: row.team_activation_materializer,
            causes: row.team_activation_causes as TaskTeamActivation['causes'],
          }
        : null,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
    sessionId: row.session_id,
    sourceMessageId: row.input_message_id,
    generation: row.generation === null ? null : Number(row.generation),
    laneSequence: row.lane_sequence === null ? null : Number(row.lane_sequence),
  };

  return {
    task: rehydrateTask(taskSnapshot),
    latestRun:
      row.latest_run_id &&
      row.latest_run_attempt !== null &&
      row.latest_run_status !== null &&
      row.latest_run_created_at !== null &&
      row.latest_run_updated_at !== null
        ? {
            runId: row.latest_run_id,
            attempt: row.latest_run_attempt,
            status: row.latest_run_status,
            runtime:
              (row.latest_run_runtime as TaskLatestRunSummary['runtime']) ??
              null,
            result:
              (row.latest_run_result as TaskLatestRunSummary['result']) ?? null,
            error:
              (row.latest_run_error as TaskLatestRunSummary['error']) ?? null,
            createdAt: toIsoInstant(row.latest_run_created_at),
            updatedAt: toIsoInstant(row.latest_run_updated_at),
          }
        : null,
  };
}

function toIsoInstant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
