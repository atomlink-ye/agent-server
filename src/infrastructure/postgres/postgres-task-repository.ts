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
          invokable_kind,
          invokable_version_id,
          input_snapshot_ref,
          input_fingerprint,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
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
          invokable_kind = EXCLUDED.invokable_kind,
          invokable_version_id = EXCLUDED.invokable_version_id,
          input_snapshot_ref = EXCLUDED.input_snapshot_ref,
          input_fingerprint = EXCLUDED.input_fingerprint,
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
        task.invokableKind,
        task.invokableVersionId,
        task.inputSnapshotRef,
        task.inputFingerprint,
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
          AND tasks.workspace_id = $3
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
          AND tasks.workspace_id = $3
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
  readonly invokable_kind: Task['invokableKind'];
  readonly invokable_version_id: string;
  readonly input_snapshot_ref: string;
  readonly input_fingerprint: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
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
    tasks.invokable_kind,
    tasks.invokable_version_id,
    tasks.input_snapshot_ref,
    tasks.input_fingerprint,
    tasks.created_at,
    tasks.updated_at,
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
    invokableKind: row.invokable_kind,
    invokableVersionId: row.invokable_version_id,
    inputSnapshotRef: row.input_snapshot_ref,
    inputFingerprint: row.input_fingerprint,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
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
