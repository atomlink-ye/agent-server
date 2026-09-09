import type {
  WorkPreparationRepository,
  WorkPreparationOwner,
} from '../../application/ports/work-preparation-repository.js';
import type {
  WorkPreparation,
  WorkPreparationStatus,
} from '../../domain/work/work-preparation.js';

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}
interface Client extends Queryable {
  release(): void;
}
interface Connectable extends Queryable {
  connect(): Promise<Client>;
}
type Database = Queryable | Connectable;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  work_id: string;
  revision: number | string;
  status: WorkPreparationStatus;
  definition_version_id: string;
  schema_fingerprint: string;
  candidate_input: Readonly<Record<string, unknown>>;
  confirmed_fingerprint: string | null;
  start_intent: string | null;
  work_run_id: string | null;
  source_message_id: string | null;
  missing: readonly string[];
  ambiguities: readonly string[];
  created_at: string | Date;
  updated_at: string | Date;
};

const COLUMNS = `id,tenant_id,workspace_id,work_id,revision,status,definition_version_id,
 schema_fingerprint,candidate_input,confirmed_fingerprint,start_intent,work_run_id,
  missing,ambiguities,source_message_id,created_at,updated_at`;

export class PostgresWorkPreparationRepository implements WorkPreparationRepository {
  public constructor(private readonly database: Database) {}

  public async findCurrent(input: {
    owner: WorkPreparationOwner;
    workId: string;
  }) {
    const result = await this.database.query<Row>(
      `SELECT ${COLUMNS} FROM work_preparations WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
       AND status <> 'abandoned' ORDER BY revision DESC LIMIT 1`,
      [input.owner.tenantId, input.owner.workspaceId, input.workId],
    );
    return result.rows?.[0] ? mapRow(result.rows[0]) : null;
  }

  public async upsert(
    input: Parameters<WorkPreparationRepository['upsert']>[0],
  ) {
    const client = await this.transactionClient();
    try {
      await client.query('BEGIN');
      if (input.sourceMessageId) {
        const source = await client.query<Row>(
          `SELECT ${COLUMNS} FROM work_preparations
           WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3 AND source_message_id=$4
           LIMIT 1 FOR UPDATE`,
          [
            input.owner.tenantId,
            input.owner.workspaceId,
            input.workId,
            input.sourceMessageId,
          ],
        );
        if (source.rows?.[0]) {
          await client.query('COMMIT');
          return mapRow(source.rows[0]);
        }
      }
      const existing = await client.query<Row>(
        `SELECT ${COLUMNS} FROM work_preparations WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
         AND status NOT IN ('started','abandoned') ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
        [input.owner.tenantId, input.owner.workspaceId, input.workId],
      );
      const row = existing.rows?.[0];
      if (row) {
        if (row.status === 'starting') {
          await client.query('COMMIT');
          return mapRow(row);
        }
        const updated = await client.query<Row>(
          `UPDATE work_preparations SET revision=revision+1,candidate_input=$1,missing=$2,ambiguities=$3,status=$4,source_message_id=$7,updated_at=$5
           WHERE id=$6 RETURNING ${COLUMNS}`,
          [
            JSON.stringify(input.candidateInput),
            input.missing,
            input.ambiguities,
            input.status,
            input.now,
            row.id,
            input.sourceMessageId ?? null,
          ],
        );
        await client.query('COMMIT');
        return mapRow(updated.rows![0]!);
      }
      const result = await client.query<Row>(
        `INSERT INTO work_preparations
         (id,tenant_id,workspace_id,work_id,revision,status,definition_version_id,schema_fingerprint,candidate_input,missing,ambiguities,source_message_id,created_at,updated_at)
         VALUES(gen_random_uuid(),$1,$2,$3,COALESCE((SELECT max(revision)+1 FROM work_preparations WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3),1),$4,$5,$6,$7,$8,$9,$10,$11,$11)
         RETURNING ${COLUMNS}`,
        [
          input.owner.tenantId,
          input.owner.workspaceId,
          input.workId,
          input.status,
          input.definitionVersionId,
          input.schemaFingerprint,
          JSON.stringify(input.candidateInput),
          input.missing,
          input.ambiguities,
          input.sourceMessageId ?? null,
          input.now,
        ],
      );
      await client.query('COMMIT');
      return mapRow(result.rows![0]!);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async beginConfirmation(
    input: Parameters<WorkPreparationRepository['beginConfirmation']>[0],
  ) {
    const client = await this.transactionClient();
    try {
      await client.query('BEGIN');
      const result = await client.query<Row>(
        `UPDATE work_preparations SET status='starting',confirmed_fingerprint=$1,start_intent=$2,updated_at=$3
         WHERE id=$4 AND tenant_id=$5 AND workspace_id=$6 AND work_id=$7 AND revision=$8
           AND status IN ('ready','starting')
           AND NOT EXISTS (
             SELECT 1 FROM work_chat_messages m
             WHERE m.tenant_id=$5 AND m.workspace_id=$6 AND m.work_id=$7
               AND m.kind='user' AND m.status IN ('queued','processing')
           )
         RETURNING ${COLUMNS}`,
        [
          input.fingerprint,
          input.startIntent,
          input.now,
          input.preparationId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.workId,
          input.expectedRevision,
        ],
      );
      await client.query('COMMIT');
      if (result.rows?.[0]) return mapRow(result.rows[0]);
      const completed = await client.query<Row>(
        `SELECT ${COLUMNS} FROM work_preparations
         WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND work_id=$4
           AND status='started' AND work_run_id IS NOT NULL`,
        [
          input.preparationId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.workId,
        ],
      );
      return completed.rows?.[0] ? mapRow(completed.rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async associateRun(
    input: Parameters<WorkPreparationRepository['associateRun']>[0],
  ) {
    const result = await this.database.query<Row>(
      `UPDATE work_preparations SET status='started',work_run_id=$1,updated_at=$2
       WHERE id=$3 AND tenant_id=$4 AND workspace_id=$5 AND status='starting'
       RETURNING ${COLUMNS}`,
      [
        input.workRunId,
        input.now,
        input.preparationId,
        input.owner.tenantId,
        input.owner.workspaceId,
      ],
    );
    if (!result.rows?.[0]) {
      const existing = await this.database.query<Row>(
        `SELECT ${COLUMNS} FROM work_preparations WHERE id=$1`,
        [input.preparationId],
      );
      if (existing.rows?.[0]?.work_run_id === input.workRunId)
        return mapRow(existing.rows[0]);
      throw new Error('work_preparation_association_conflict');
    }
    return mapRow(result.rows[0]);
  }

  public async findByStartIntent(
    input: Parameters<WorkPreparationRepository['findByStartIntent']>[0],
  ) {
    const result = await this.database.query<Row>(
      `SELECT ${COLUMNS} FROM work_preparations WHERE tenant_id=$1 AND workspace_id=$2 AND start_intent=$3`,
      [input.owner.tenantId, input.owner.workspaceId, input.startIntent],
    );
    return result.rows?.[0] ? mapRow(result.rows[0]) : null;
  }

  public async hasPendingUserMessages(input: {
    owner: WorkPreparationOwner;
    workId: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM work_chat_messages
       WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
         AND kind='user' AND status IN ('queued','processing') LIMIT 1`,
      [input.owner.tenantId, input.owner.workspaceId, input.workId],
    );
    return (result.rows?.length ?? 0) > 0;
  }

  private async transactionClient(): Promise<Client> {
    if (
      'connect' in this.database &&
      typeof this.database.connect === 'function'
    )
      return this.database.connect();
    throw new Error(
      'Work preparation persistence requires a transaction client.',
    );
  }
}

function mapRow(row: Row): WorkPreparation {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    workId: row.work_id,
    revision: Number(row.revision),
    status: row.status,
    definitionVersionId: row.definition_version_id,
    schemaFingerprint: row.schema_fingerprint,
    candidateInput: row.candidate_input ?? {},
    confirmedFingerprint: row.confirmed_fingerprint,
    startIntent: row.start_intent,
    workRunId: row.work_run_id,
    sourceMessageId: row.source_message_id,
    missing: row.missing ?? [],
    ambiguities: row.ambiguities ?? [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
