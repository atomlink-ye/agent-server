import type {
  DagTeamExecutionRepository,
  OwnerScope,
  RecordNodeResultInput,
} from '../../application/ports/team-execution-repository.js';
import type {
  TeamExecution,
  TeamNodeExecution,
} from '../../domain/invokables/team-execution.js';

interface QueryResult<Row> {
  readonly rows?: readonly Row[];
  readonly rowCount?: number | null;
}

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

interface TransactionalClient extends Queryable {
  release(): void;
}

interface Connectable extends Queryable {
  connect(): Promise<TransactionalClient>;
}

interface TeamExecutionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly root_task_id: string;
  readonly root_run_id: string;
  readonly team_version_id: string;
  readonly environment_version_id: string;
  readonly status: TeamExecution['status'];
  readonly result: string | null;
  readonly failure_detail: string | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

interface JoinedExecutionRow extends TeamExecutionRow {
  readonly node_id: string | null;
  readonly node_execution_id: string | null;
  readonly dependency_node_ids: unknown;
  readonly child_task_id: string | null;
  readonly child_run_id: string | null;
  readonly node_status: TeamNodeExecution['status'] | null;
  readonly node_result: string | null;
  readonly node_failure_detail: string | null;
  readonly node_created_at: string | Date | null;
  readonly node_updated_at: string | Date | null;
}

export class PostgresDagTeamExecutionRepository implements DagTeamExecutionRepository {
  public constructor(private readonly database: Connectable) {}

  public async create(execution: TeamExecution): Promise<void> {
    const client = await this.database.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `
          INSERT INTO team_executions (
            id, tenant_id, workspace_id, principal_type, principal_id,
            root_task_id, root_run_id, team_version_id, environment_version_id,
            status, result, failure_detail, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          execution.id,
          execution.tenantId,
          execution.workspaceId,
          execution.principalType,
          execution.principalId,
          execution.rootTaskId,
          execution.rootRunId,
          execution.teamVersionId,
          execution.environmentVersionId,
          execution.status,
          execution.result,
          execution.failureDetail,
          execution.createdAt,
          execution.updatedAt,
        ],
      );

      for (const node of execution.nodes) {
        await client.query(
          `
            INSERT INTO team_node_executions (
              id, team_execution_id, node_id, dependency_node_ids,
              child_task_id, child_run_id, status, result, failure_detail,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            node.id,
            node.teamExecutionId,
            node.nodeId,
            JSON.stringify(node.dependencyNodeIds),
            node.childTaskId,
            node.childRunId,
            node.status,
            node.result,
            node.failureDetail,
            node.createdAt,
            node.updatedAt,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async findById(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamExecution | null> {
    return this.load(
      'te.id = $1 AND te.tenant_id = $2 AND te.workspace_id = $3 AND te.principal_type = $4 AND te.principal_id = $5',
      [id, ...ownerValues(owner)],
    );
  }

  public async findByRootRunId(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamExecution | null> {
    return this.load(
      'te.root_run_id = $1 AND te.tenant_id = $2 AND te.workspace_id = $3 AND te.principal_type = $4 AND te.principal_id = $5',
      [id, ...ownerValues(owner)],
    );
  }

  public async findByChildTaskId(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamExecution | null> {
    return this.load(
      `
        EXISTS (
          SELECT 1
          FROM team_node_executions child_node
          WHERE child_node.team_execution_id = te.id
            AND child_node.child_task_id = $1
        )
        AND te.tenant_id = $2
        AND te.workspace_id = $3
        AND te.principal_type = $4
        AND te.principal_id = $5
      `,
      [id, ...ownerValues(owner)],
    );
  }

  public async recordNodeResult(
    input: RecordNodeResultInput,
  ): Promise<TeamExecution> {
    const client = await this.database.connect();

    try {
      await client.query('BEGIN');
      const locked = await client.query<TeamExecutionRow>(
        `
          SELECT *
          FROM team_executions
          WHERE id = $1
            AND tenant_id = $2
            AND workspace_id = $3
            AND principal_type = $4
            AND principal_id = $5
          FOR UPDATE
        `,
        [input.teamExecutionId, ...ownerValues(input)],
      );
      if (!locked.rows?.[0]) {
        throw new TeamExecutionNotFoundError();
      }

      const updated = await client.query(
        `
          UPDATE team_node_executions
          SET status = $3,
              child_task_id = COALESCE($4, child_task_id),
              child_run_id = COALESCE($5, child_run_id),
              result = $6,
              failure_detail = $7,
              updated_at = now()
          WHERE team_execution_id = $1
            AND node_id = $2
        `,
        [
          input.teamExecutionId,
          input.nodeId,
          input.status,
          input.childTaskId ?? null,
          input.childRunId ?? null,
          input.result ?? null,
          input.failureDetail ?? null,
        ],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        throw new TeamNodeExecutionNotFoundError();
      }

      const execution = await this.loadWith(client, 'te.id = $1', [
        input.teamExecutionId,
      ]);
      if (!execution) {
        throw new TeamExecutionNotFoundError();
      }

      await client.query('COMMIT');
      return execution;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async setStatus(
    id: string,
    owner: OwnerScope,
    status: TeamExecution['status'],
    result: string | null = null,
    failureDetail: string | null = null,
  ): Promise<void> {
    await this.database.query(
      `
        UPDATE team_executions
        SET status = $1, result = $2, failure_detail = $3, updated_at = now()
        WHERE id = $4
          AND tenant_id = $5
          AND workspace_id = $6
          AND principal_type = $7
          AND principal_id = $8
      `,
      [status, result, failureDetail, id, ...ownerValues(owner)],
    );
  }

  public async environmentVersionForChild(
    id: string,
    owner: OwnerScope,
  ): Promise<string | null> {
    const result = await this.database.query<{
      environment_version_id: string;
    }>(
      `
        SELECT environment_version_id
        FROM team_executions
        WHERE id = $1
          AND tenant_id = $2
          AND workspace_id = $3
          AND principal_type = $4
          AND principal_id = $5
      `,
      [id, ...ownerValues(owner)],
    );
    return result.rows?.[0]?.environment_version_id ?? null;
  }

  private async load(
    predicate: string,
    values: readonly unknown[],
  ): Promise<TeamExecution | null> {
    return this.loadWith(this.database, predicate, values);
  }

  private async loadWith(
    database: Queryable,
    predicate: string,
    values: readonly unknown[],
  ): Promise<TeamExecution | null> {
    const result = await database.query<JoinedExecutionRow>(
      `
        SELECT
          te.id, te.tenant_id, te.workspace_id, te.principal_type, te.principal_id,
          te.root_task_id, te.root_run_id, te.team_version_id,
          te.environment_version_id, te.status, te.result, te.failure_detail,
          te.created_at, te.updated_at,
          tn.id AS node_execution_id, tn.node_id, tn.dependency_node_ids,
          tn.child_task_id, tn.child_run_id, tn.status AS node_status,
          tn.result AS node_result, tn.failure_detail AS node_failure_detail,
          tn.created_at AS node_created_at, tn.updated_at AS node_updated_at
        FROM team_executions te
        LEFT JOIN team_node_executions tn ON tn.team_execution_id = te.id
        WHERE ${predicate}
        ORDER BY tn.node_id
      `,
      values,
    );
    return mapExecutionRows(result.rows ?? []);
  }
}

export class TeamExecutionNotFoundError extends Error {
  public constructor() {
    super('Team execution was not found.');
    this.name = 'TeamExecutionNotFoundError';
  }
}

export class TeamNodeExecutionNotFoundError extends Error {
  public constructor() {
    super('Team node execution was not found.');
    this.name = 'TeamNodeExecutionNotFoundError';
  }
}

function mapExecutionRows(
  rows: readonly JoinedExecutionRow[],
): TeamExecution | null {
  const first = rows[0];
  if (!first) return null;

  const nodes = rows
    .filter(
      (
        row,
      ): row is JoinedExecutionRow & { readonly node_execution_id: string } =>
        row.node_execution_id !== null,
    )
    .map(mapNodeRow);

  return {
    id: first.id,
    tenantId: first.tenant_id,
    workspaceId: first.workspace_id,
    principalType: first.principal_type,
    principalId: first.principal_id,
    rootTaskId: first.root_task_id,
    rootRunId: first.root_run_id,
    teamVersionId: first.team_version_id,
    environmentVersionId: first.environment_version_id,
    status: first.status,
    result: first.result,
    failureDetail: first.failure_detail,
    nodes,
    createdAt: toIsoInstant(first.created_at),
    updatedAt: toIsoInstant(first.updated_at),
  };
}

function mapNodeRow(
  row: JoinedExecutionRow & { readonly node_execution_id: string },
): TeamNodeExecution {
  return {
    id: row.node_execution_id,
    teamExecutionId: row.id,
    nodeId: row.node_id!,
    dependencyNodeIds: dependencyIds(row.dependency_node_ids),
    childTaskId: row.child_task_id,
    childRunId: row.child_run_id,
    status: row.node_status!,
    result: row.node_result,
    failureDetail: row.node_failure_detail,
    createdAt: toIsoInstant(row.node_created_at!),
    updatedAt: toIsoInstant(row.node_updated_at!),
  };
}

function dependencyIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toIsoInstant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function ownerValues(owner: OwnerScope): readonly string[] {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
  ];
}
