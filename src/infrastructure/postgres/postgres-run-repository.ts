import type {
  ClaimedRun,
  ClaimNextQueuedRunOptions,
  CompleteClaimedRunOptions,
  RunOwnerScope,
  RunRepository,
  SaveRunOptions,
} from '../../application/ports/run-repository.js';
import { RunCompletionConflictError as RunCompletionConflict } from '../../application/ports/run-repository.js';
import { decodeRootTaskRunRequestSnapshotRef } from '../../application/tasks/root-task-input.js';
import {
  rehydrateRun,
  type Run,
  type RunSnapshot,
} from '../../domain/runs/run.js';

interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface RunRow {
  readonly id: string;
  readonly task_id: string;
  readonly attempt: number;
  readonly status: Run['status'];
  readonly lease_owner: string | null;
  readonly activation_id: string | null;
  readonly lease_expires_at: string | Date | null;
  readonly runtime: Record<string, unknown> | null;
  readonly result: Record<string, unknown> | null;
  readonly usage: Record<string, unknown> | null;
  readonly error: Record<string, unknown> | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly fencing_token: number;
  readonly input_snapshot_ref: string;
}

interface ExistingRunRow {
  readonly task_id: string;
  readonly attempt: number;
  readonly lease_owner: string | null;
  readonly activation_id: string | null;
  readonly fencing_token: number;
  readonly lease_expires_at: string | null;
}

export class PostgresRunRepository implements RunRepository {
  public constructor(private readonly database: PostgresQueryable) {}

  public async save(run: Run, options: SaveRunOptions = {}): Promise<void> {
    if (options.taskId && options.attempt) {
      await this.insert(run, options.taskId, options.attempt);
      return;
    }

    const existing = await this.loadExisting(run.id);
    if (!existing) {
      throw new Error(
        'Saving a new Postgres run requires taskId and attempt metadata',
      );
    }

    const persisted = toPersistedRunState(run, existing);

    await this.database.query(
      `
        UPDATE runs
        SET
          status = $2,
          lease_owner = $3,
          activation_id = $4,
          fencing_token = $5,
          lease_expires_at = $6,
          runtime = $7::jsonb,
          result = $8::jsonb,
          usage = $9::jsonb,
          error = $10::jsonb,
          updated_at = $11
        WHERE id = $1
      `,
      [
        run.id,
        run.status,
        persisted.leaseOwner,
        persisted.activationId,
        persisted.fencingToken,
        persisted.leaseExpiresAt,
        persisted.runtimeJson,
        persisted.resultJson,
        persisted.usageJson,
        persisted.errorJson,
        run.updatedAt,
      ],
    );
  }

  public async findById(id: string): Promise<Run | null> {
    return this.findSingle(
      `${RUN_SELECT_SQL}
        WHERE runs.id = $1
      `,
      [id],
    );
  }

  public async findByIdForOwner(
    id: string,
    ownerScope: RunOwnerScope,
  ): Promise<Run | null> {
    return this.findSingle(
      `${RUN_SELECT_SQL}
        WHERE runs.id = $1
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
  }

  public async findByTaskId(taskId: string): Promise<Run | null> {
    return this.findSingle(
      `${RUN_SELECT_SQL}
        WHERE runs.task_id = $1
        ORDER BY runs.attempt ASC
        LIMIT 1
      `,
      [taskId],
    );
  }

  public async claimNextQueued(
    options: ClaimNextQueuedRunOptions,
  ): Promise<ClaimedRun | null> {
    const result = await this.database.query<RunRow>(
      `
        WITH next_dispatch AS (
          SELECT run_dispatches.id AS dispatch_id, run_dispatches.run_id
          FROM run_dispatches
          INNER JOIN runs ON runs.id = run_dispatches.run_id
          WHERE run_dispatches.event_type = 'run.enqueue'
            AND run_dispatches.published_at IS NULL
            AND runs.status = 'queued'
          ORDER BY run_dispatches.id ASC
          LIMIT 1
        ),
        claimed_run AS (
          UPDATE runs
          SET
            status = 'running',
            lease_owner = $1,
            activation_id = $2,
            fencing_token = runs.fencing_token + 1,
            lease_expires_at = $4,
            updated_at = $3
          FROM next_dispatch
          WHERE runs.id = next_dispatch.run_id
            AND runs.status = 'queued'
            AND runs.lease_owner IS NULL
            AND runs.activation_id IS NULL
            AND runs.lease_expires_at IS NULL
            AND runs.fencing_token = 0
          RETURNING
            runs.id,
            runs.task_id,
            runs.attempt,
            runs.status,
            runs.lease_owner,
            runs.activation_id,
            runs.lease_expires_at,
            runs.runtime,
            runs.result,
            runs.usage,
            runs.error,
            runs.created_at,
            runs.updated_at,
            runs.fencing_token,
            next_dispatch.dispatch_id
        ),
        published_dispatch AS (
          UPDATE run_dispatches
          SET published_at = $3
          WHERE id IN (SELECT dispatch_id FROM claimed_run)
        )
        SELECT
          claimed_run.id,
          claimed_run.task_id,
          claimed_run.attempt,
          claimed_run.status,
          claimed_run.lease_owner,
          claimed_run.activation_id,
          claimed_run.lease_expires_at,
          claimed_run.runtime,
          claimed_run.result,
          claimed_run.usage,
          claimed_run.error,
          claimed_run.created_at,
          claimed_run.updated_at,
          claimed_run.fencing_token,
          tasks.input_snapshot_ref
        FROM claimed_run
        INNER JOIN tasks ON tasks.id = claimed_run.task_id
      `,
      [
        options.workerId,
        options.activationId,
        options.claimedAt,
        options.leaseExpiresAt,
      ],
    );

    const row = result.rows?.[0];
    return row ? mapClaimedRunRow(row) : null;
  }

  public async completeClaimed(
    options: CompleteClaimedRunOptions,
  ): Promise<Run> {
    const result = await this.database.query(
      `
        UPDATE runs
        SET
          status = $2,
          lease_owner = NULL,
          activation_id = NULL,
          lease_expires_at = NULL,
          runtime = $3::jsonb,
          result = $4::jsonb,
          usage = $5::jsonb,
          error = $6::jsonb,
          updated_at = $7
        WHERE id = $1
          AND status = 'running'
          AND lease_owner = $8
          AND activation_id = $9
          AND fencing_token = $10
        RETURNING id
      `,
      [
        options.run.id,
        options.run.status,
        toJsonValue(options.run.runtime),
        toJsonValue(options.run.result),
        toJsonValue(options.run.usage),
        toJsonValue(options.run.error),
        options.run.updatedAt,
        options.claim.workerId,
        options.claim.activationId,
        options.claim.fencingToken,
      ],
    );

    if ((result.rows?.length ?? result.rowCount ?? 0) < 1) {
      throw new RunCompletionConflict();
    }

    const persisted = await this.findById(options.run.id);
    if (!persisted) {
      throw new Error('Completed run could not be reloaded');
    }

    return persisted;
  }

  private async insert(
    run: Run,
    taskId: string,
    attempt: number,
  ): Promise<void> {
    const persisted = toPersistedRunState(run, {
      task_id: taskId,
      attempt,
      lease_owner: null,
      activation_id: null,
      fencing_token: 0,
      lease_expires_at: null,
    });

    await this.database.query(
      `
        INSERT INTO runs (
          id,
          task_id,
          attempt,
          status,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at,
          runtime,
          result,
          usage,
          error,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14
        )
      `,
      [
        run.id,
        taskId,
        attempt,
        run.status,
        persisted.leaseOwner,
        persisted.activationId,
        persisted.fencingToken,
        persisted.leaseExpiresAt,
        persisted.runtimeJson,
        persisted.resultJson,
        persisted.usageJson,
        persisted.errorJson,
        run.createdAt,
        run.updatedAt,
      ],
    );
  }

  private async loadExisting(id: string): Promise<ExistingRunRow | null> {
    const result = await this.database.query<ExistingRunRow>(
      `
        SELECT
          task_id,
          attempt,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at
        FROM runs
        WHERE id = $1
      `,
      [id],
    );

    return result.rows?.[0] ?? null;
  }

  private async findSingle(
    sql: string,
    values: readonly unknown[],
  ): Promise<Run | null> {
    const result = await this.database.query<RunRow>(sql, values);
    const row = result.rows?.[0];
    return row ? mapRunRow(row) : null;
  }
}

const RUN_SELECT_SQL = `
  SELECT
    runs.id,
    runs.task_id,
    runs.attempt,
    runs.status,
    runs.lease_owner,
    runs.activation_id,
    runs.lease_expires_at,
    runs.runtime,
    runs.result,
    runs.usage,
    runs.error,
    runs.created_at,
    runs.updated_at,
    runs.fencing_token,
    tasks.input_snapshot_ref
  FROM runs
  INNER JOIN tasks ON tasks.id = runs.task_id
`;

function mapClaimedRunRow(row: RunRow): ClaimedRun {
  if (!row.lease_owner || !row.activation_id || !row.lease_expires_at) {
    throw new Error('Claimed run row is missing lease metadata');
  }

  return {
    run: mapRunRow(row),
    taskId: row.task_id,
    attempt: row.attempt,
    workerId: row.lease_owner,
    activationId: row.activation_id,
    fencingToken: row.fencing_token,
    leaseExpiresAt: toIsoInstant(row.lease_expires_at),
  };
}

function mapRunRow(row: RunRow): Run {
  const snapshot: RunSnapshot = {
    id: row.id,
    prompt: decodeRootTaskRunRequestSnapshotRef(row.input_snapshot_ref).prompt,
    status: row.status,
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
    ...(row.runtime
      ? { runtime: row.runtime as unknown as NonNullable<Run['runtime']> }
      : {}),
    ...(row.result
      ? { result: row.result as unknown as NonNullable<Run['result']> }
      : {}),
    ...(row.usage
      ? { usage: row.usage as unknown as NonNullable<Run['usage']> }
      : {}),
    ...(row.error
      ? { error: row.error as unknown as NonNullable<Run['error']> }
      : {}),
  };

  return rehydrateRun(snapshot);
}

function toIsoInstant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toPersistedRunState(run: Run, existing: ExistingRunRow) {
  if (run.status === 'running') {
    if (
      !existing.lease_owner ||
      !existing.activation_id ||
      !existing.lease_expires_at ||
      existing.fencing_token < 1
    ) {
      throw new Error(
        'Running runs require an existing claim before persistence',
      );
    }

    return {
      leaseOwner: existing.lease_owner,
      activationId: existing.activation_id,
      fencingToken: existing.fencing_token,
      leaseExpiresAt: existing.lease_expires_at,
      runtimeJson: toJsonValue(run.runtime),
      resultJson: null,
      usageJson: null,
      errorJson: null,
    };
  }

  if (run.status !== 'queued' && existing.fencing_token < 1) {
    throw new Error('Terminal runs require an existing fencing token');
  }

  return {
    leaseOwner: null,
    activationId: null,
    fencingToken: run.status === 'queued' ? 0 : existing.fencing_token,
    leaseExpiresAt: null,
    runtimeJson: toJsonValue(run.runtime),
    resultJson: toJsonValue(run.result),
    usageJson: toJsonValue(run.usage),
    errorJson: toJsonValue(run.error),
  };
}

function toJsonValue(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}
