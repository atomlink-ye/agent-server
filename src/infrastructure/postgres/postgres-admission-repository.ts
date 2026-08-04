import type {
  AdmissionOwnerScope,
  AdmissionRecord,
  AdmissionRepository,
  AdmissionTransaction,
} from '../../application/ports/admission-repository.js';
import type { AdmissionIngress } from '../../application/sessions/session-turn-origin.js';
import { AdmissionAlreadyExistsError as AdmissionAlreadyExists } from '../../application/ports/admission-repository.js';
import { PostgresRunRepository } from './postgres-run-repository.js';
import { PostgresTaskRepository } from './postgres-task-repository.js';
import { PostgresTeamExecutionRepository } from './postgres-collaborative-team-repository.js';
import { PostgresTeamMessageRepository } from './postgres-team-message-repository.js';

interface PostgresQueryResult<Row> {
  readonly rows?: readonly Row[];
  readonly rowCount?: number | null;
}

interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  exec?(sql: string): Promise<unknown>;
}

interface PostgresConnectable {
  connect(): Promise<PostgresTransactionalClient>;
}

interface PostgresTransactionalClient extends PostgresQueryable {
  release?(): void;
}

interface AdmissionRow {
  readonly session_id: string | null;
  readonly ingress: 'api' | 'lark';
  readonly origin_ref: string | null;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly task_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly policy_snapshot_version: string;
  readonly created_at: string;
}

export class PostgresAdmissionRepository implements AdmissionRepository {
  public constructor(
    private readonly database: PostgresQueryable | PostgresConnectable,
  ) {}

  public async withTransaction<T>(
    work: (transaction: AdmissionTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.acquireClient();

    await client.query('BEGIN');

    try {
      const transaction = new PostgresAdmissionTransaction(client);
      const result = await work(transaction);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  private async acquireClient(): Promise<PostgresTransactionalClient> {
    if ('connect' in this.database) {
      return this.database.connect();
    }

    return this.database;
  }
}

class PostgresAdmissionTransaction implements AdmissionTransaction {
  public readonly tasks: PostgresTaskRepository;
  public readonly runs: PostgresRunRepository;
  public readonly teamExecutions: PostgresTeamExecutionRepository;
  public readonly teamMessages: PostgresTeamMessageRepository;

  public constructor(private readonly database: PostgresTransactionalClient) {
    this.tasks = new PostgresTaskRepository(database);
    this.runs = new PostgresRunRepository(database);
    this.teamExecutions = new PostgresTeamExecutionRepository(
      database as never,
    );
    this.teamMessages = new PostgresTeamMessageRepository(database);
  }

  public async findByIngressAndIdempotencyKey(
    ingress: AdmissionIngress,
    idempotencyKey: string,
    scope: AdmissionOwnerScope,
  ): Promise<AdmissionRecord | null> {
    const result = await this.database.query<AdmissionRow>(
      `
        SELECT
          ingress,
          origin_ref,
          idempotency_key,
          request_fingerprint,
          task_id,
          session_id,
          tenant_id,
          workspace_id,
          principal_type,
          principal_id,
          policy_snapshot_version,
          created_at
        FROM admissions
        WHERE ingress = $1
          AND idempotency_key = $2
          AND tenant_id = $3
          AND workspace_id = $4
          AND principal_type = $5
          AND principal_id = $6
          AND session_id IS NULL
      `,
      [
        ingress,
        idempotencyKey,
        scope.tenantId,
        scope.workspaceId,
        scope.principalType,
        scope.principalId,
      ],
    );

    const row = result.rows?.[0];
    if (!row) {
      return null;
    }

    const fields = {
      idempotencyKey: row.idempotency_key,
      requestFingerprint: row.request_fingerprint,
      taskId: row.task_id,
      sessionId: row.session_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
      policySnapshotVersion: row.policy_snapshot_version,
      createdAt: row.created_at,
    };

    return row.ingress === 'api'
      ? { ...fields, ingress: 'api', originRef: null }
      : { ...fields, ingress: 'lark', originRef: row.origin_ref ?? '' };
  }

  public async save(record: AdmissionRecord): Promise<void> {
    try {
      await this.database.query(
        `
          INSERT INTO admissions (
            ingress,
            origin_ref,
            idempotency_key,
            request_fingerprint,
            task_id,
            session_id,
            tenant_id,
            workspace_id,
            principal_type,
            principal_id,
            policy_snapshot_version,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          record.ingress,
          record.originRef,
          record.idempotencyKey,
          record.requestFingerprint,
          record.taskId,
          record.sessionId ?? null,
          record.tenantId,
          record.workspaceId,
          record.principalType,
          record.principalId,
          record.policySnapshotVersion,
          record.createdAt,
        ],
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AdmissionAlreadyExists();
      }

      throw error;
    }
  }

  public async enqueueRunDispatch(
    runId: string,
    createdAt: string,
  ): Promise<void> {
    await this.database.query(
      `
        INSERT INTO run_dispatches (
          run_id,
          event_type,
          published_at,
          created_at
        ) VALUES ($1, 'run.enqueue', NULL, $2)
      `,
      [runId, createdAt],
    );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  const message =
    'message' in error && typeof error.message === 'string'
      ? error.message
      : undefined;

  return (
    code === '23505' ||
    /duplicate key value violates unique constraint/i.test(message ?? '')
  );
}
