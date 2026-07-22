import type { TaskRepository } from '../../application/ports/task-repository.js';
import type { Task } from '../../domain/tasks/task.js';

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
          status,
          ingress,
          invokable_kind,
          invokable_version_id,
          input_snapshot_ref,
          input_fingerprint,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
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
}
