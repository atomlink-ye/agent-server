import type {
  WorkRunInputRecord,
  WorkRunInputStore,
} from '../../application/ports/work-run-input-store.js';
import type { WorkIdentityOwnerScope } from '../../application/ports/work-identity-repository.js';
import type { WorkInputSnapshot } from '../../domain/work/work-input-schema.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

type Row = {
  id: string;
  input_snapshot: WorkInputSnapshot | null;
  input_fingerprint: string | null;
};

export class PostgresWorkRunInputStore implements WorkRunInputStore {
  public constructor(private readonly database: Queryable) {}

  public async record(input: {
    readonly workRunId: string;
    readonly owner: WorkIdentityOwnerScope;
    readonly snapshot: WorkInputSnapshot;
    readonly fingerprint: string;
  }): Promise<WorkRunInputRecord> {
    const updated = await this.database.query<Row>(
      `UPDATE work_runs
          SET input_snapshot=COALESCE(input_snapshot,$1::jsonb),
              input_fingerprint=COALESCE(input_fingerprint,$2),
              updated_at=CASE WHEN input_fingerprint IS NULL THEN now() ELSE updated_at END
        WHERE id=$3 AND tenant_id=$4 AND workspace_id=$5
          AND (input_fingerprint IS NULL OR input_fingerprint=$2)
        RETURNING id,input_snapshot,input_fingerprint`,
      [
        JSON.stringify(input.snapshot),
        input.fingerprint,
        input.workRunId,
        input.owner.tenantId,
        input.owner.workspaceId,
      ],
    );
    const row = updated.rows?.[0];
    if (!row) {
      const existing = await this.find(input.workRunId, input.owner);
      if (existing) throw new WorkRunInputConflictError();
      throw new WorkRunInputNotFoundError();
    }
    if (!row.input_snapshot || row.input_fingerprint !== input.fingerprint)
      throw new WorkRunInputConflictError();
    if (JSON.stringify(row.input_snapshot) !== JSON.stringify(input.snapshot))
      throw new WorkRunInputConflictError();
    return {
      workRunId: row.id,
      input: Object.freeze({ ...row.input_snapshot }),
      fingerprint: row.input_fingerprint,
    };
  }

  public async find(
    workRunId: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<WorkRunInputRecord | null> {
    const result = await this.database.query<Row>(
      `SELECT id,input_snapshot,input_fingerprint
         FROM work_runs
        WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`,
      [workRunId, owner.tenantId, owner.workspaceId],
    );
    const row = result.rows?.[0];
    if (!row || !row.input_snapshot || !row.input_fingerprint) return null;
    return {
      workRunId: row.id,
      input: Object.freeze({ ...row.input_snapshot }),
      fingerprint: row.input_fingerprint,
    };
  }
}

export class WorkRunInputConflictError extends Error {
  public readonly code = 'work_run_input_conflict';
  public constructor() {
    super(
      'The WorkRun is already bound to a different immutable input snapshot.',
    );
    this.name = 'WorkRunInputConflictError';
  }
}

export class WorkRunInputNotFoundError extends Error {
  public readonly code = 'work_run_not_found';
  public constructor() {
    super('The WorkRun was not found for this owner scope.');
    this.name = 'WorkRunInputNotFoundError';
  }
}
