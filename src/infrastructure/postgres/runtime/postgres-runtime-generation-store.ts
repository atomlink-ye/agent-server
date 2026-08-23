import type {
  RuntimeGenerationStore,
  RuntimeGenerationTransaction,
} from '../../../application/ports/runtime-generation-store.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../../domain/runtime/runtime-session.js';
import type {
  RuntimeSessionGeneration,
  RuntimeSessionGenerationStatus,
} from '../../../domain/runtime/runtime-session-generation.js';

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface Client extends Queryable {
  release(): void;
}

interface Connectable extends Queryable {
  connect(): Promise<Client>;
}

type Database = Queryable | Connectable;

interface GenerationRow extends Record<string, unknown> {
  readonly id: string;
  readonly runtime_session_id: string;
  readonly generation: number | string;
  readonly provider: string;
  readonly provider_workspace_id: string | null;
  readonly provider_session_id: string | null;
  readonly applied_spec_revision: number | string;
  readonly applied_bootstrap_digest: string;
  readonly endpoint_epoch: string;
  readonly status: RuntimeSessionGenerationStatus;
  readonly created_at: string | Date;
  readonly ready_at: string | Date | null;
  readonly superseded_at: string | Date | null;
  readonly closed_at: string | Date | null;
}

const GENERATION_SELECT_COLUMNS = `rsg.id AS id,
  rsg.runtime_session_id AS runtime_session_id,
  rsg.generation AS generation,
  rsg.provider AS provider,
  rsg.provider_workspace_id AS provider_workspace_id,
  rsg.provider_session_id AS provider_session_id,
  rsg.applied_spec_revision AS applied_spec_revision,
  rsg.applied_bootstrap_digest AS applied_bootstrap_digest,
  rsg.endpoint_epoch AS endpoint_epoch,
  rsg.status AS status,
  rsg.created_at AS created_at,
  rsg.ready_at AS ready_at,
  rsg.superseded_at AS superseded_at,
  rsg.closed_at AS closed_at`;
const GENERATION_INSERT_COLUMNS = `id,runtime_session_id,generation,provider,
  provider_workspace_id,provider_session_id,applied_spec_revision,
  applied_bootstrap_digest,endpoint_epoch,status,created_at,ready_at,
  superseded_at,closed_at`;

export class PostgresRuntimeGenerationStore
  implements RuntimeGenerationStore, RuntimeGenerationTransaction
{
  public constructor(private readonly database: Database) {}

  public async findById(
    id: RuntimeGenerationId,
  ): Promise<RuntimeSessionGeneration | null> {
    const result = await this.database.query<GenerationRow>(
      `SELECT ${GENERATION_SELECT_COLUMNS}
         FROM runtime_session_generations rsg
        WHERE rsg.id=$1`,
      [id],
    );
    return result.rows?.[0] ? mapGeneration(result.rows[0]) : null;
  }

  public async findCurrent(
    sessionId: RuntimeSessionId,
  ): Promise<RuntimeSessionGeneration | null> {
    const result = await this.database.query<GenerationRow>(
      `SELECT ${GENERATION_SELECT_COLUMNS}
         FROM runtime_session_generations rsg
         JOIN runtime_sessions rs ON rs.current_generation_id=rsg.id
        WHERE rs.id=$1 AND rsg.runtime_session_id=rs.id`,
      [sessionId],
    );
    return result.rows?.[0] ? mapGeneration(result.rows[0]) : null;
  }

  public async insert(generation: RuntimeSessionGeneration): Promise<void> {
    await this.database.query(
      `INSERT INTO runtime_session_generations
       (${GENERATION_INSERT_COLUMNS})
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        generation.id,
        generation.runtimeSessionId,
        generation.generation,
        generation.provider,
        generation.providerWorkspaceId,
        generation.providerSessionId,
        generation.appliedSpecRevision,
        generation.appliedBootstrapDigest,
        generation.endpointEpoch,
        generation.status,
        generation.createdAt,
        generation.readyAt,
        generation.supersededAt,
        generation.closedAt,
      ],
    );
  }

  public async updateAppliedSpec(input: {
    readonly id: RuntimeGenerationId;
    readonly appliedSpecRevision: RuntimeSpecRevision;
    readonly appliedBootstrapDigest: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE runtime_session_generations
          SET applied_spec_revision=$2, applied_bootstrap_digest=$3
        WHERE id=$1`,
      [input.id, input.appliedSpecRevision, input.appliedBootstrapDigest],
    );
    if (result.rowCount === 0)
      throw new Error('Runtime generation spec could not be updated.');
  }

  public async supersede(input: {
    readonly id: RuntimeGenerationId;
    readonly supersededAt: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE runtime_session_generations
          SET status='superseded', superseded_at=COALESCE(superseded_at,$2)
        WHERE id=$1 AND status <> 'closed'`,
      [input.id, input.supersededAt],
    );
    if (result.rowCount === 0)
      throw new Error('Runtime generation could not be superseded.');
  }

  public async failProvisioning(input: {
    readonly id: RuntimeGenerationId;
    readonly failedAt: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE runtime_session_generations
          SET status='failed', closed_at=COALESCE(closed_at,$2)
        WHERE id=$1 AND status='provisioning'`,
      [input.id, input.failedAt],
    );
    if (result.rowCount === 0)
      throw new Error('Provisioning runtime generation could not fail.');
  }

  public async replaceCurrentGeneration(input: {
    readonly sessionId: RuntimeSessionId;
    readonly previousGenerationId: RuntimeGenerationId | null;
    readonly generation: {
      readonly id: RuntimeGenerationId;
      readonly provider: string;
      readonly providerWorkspaceId: string | null;
      readonly providerSessionId: string;
      readonly appliedSpecRevision: RuntimeSpecRevision;
      readonly appliedBootstrapDigest: string;
      readonly endpointEpoch: string;
      readonly createdAt: string;
      readonly readyAt: string;
    };
  }): Promise<void> {
    const database = await this.transactionClient();
    try {
      await database.query('BEGIN');
      const session = await database.query<{
        current_generation_id: string | null;
      }>(
        `SELECT current_generation_id FROM runtime_sessions WHERE id=$1 FOR UPDATE`,
        [input.sessionId],
      );
      const current = session.rows?.[0];
      if (!current) throw new Error('Runtime session does not exist.');
      if (current.current_generation_id !== input.previousGenerationId)
        throw new Error('Runtime session generation binding changed.');
      if (input.generation.id === input.previousGenerationId)
        throw new Error(
          'Runtime generation replacement must change generation.',
        );

      if (input.previousGenerationId) {
        const superseded = await database.query(
          `UPDATE runtime_session_generations
              SET status='superseded', superseded_at=COALESCE(superseded_at,NOW())
            WHERE id=$1 AND runtime_session_id=$2 AND status <> 'closed'`,
          [input.previousGenerationId, input.sessionId],
        );
        if (superseded.rowCount === 0)
          throw new Error(
            'Previous runtime generation could not be superseded.',
          );
      }
      const activated = await database.query(
        `UPDATE runtime_session_generations
            SET provider_workspace_id=$3,
                provider_session_id=$4,
                applied_spec_revision=$5,
                applied_bootstrap_digest=$6,
                endpoint_epoch=$7,
                status='active',
                ready_at=$8
          WHERE id=$1
            AND runtime_session_id=$2
            AND status='provisioning'`,
        [
          input.generation.id,
          input.sessionId,
          input.generation.providerWorkspaceId,
          input.generation.providerSessionId,
          input.generation.appliedSpecRevision,
          input.generation.appliedBootstrapDigest,
          input.generation.endpointEpoch,
          input.generation.readyAt,
        ],
      );
      if (activated.rowCount !== 1)
        throw new Error('Provisioning runtime generation could not activate.');
      const updated = await database.query(
        `UPDATE runtime_sessions
            SET current_generation_id=$2, status='ready', updated_at=NOW()
          WHERE id=$1`,
        [input.sessionId, input.generation.id],
      );
      if (updated.rowCount === 0)
        throw new Error(
          'Runtime session generation binding could not be replaced.',
        );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      database.release();
    }
  }

  private async transactionClient(): Promise<Client> {
    if (
      !('connect' in this.database) ||
      typeof this.database.connect !== 'function'
    )
      throw new Error(
        'Runtime generation replacement requires a Postgres transaction client.',
      );
    return this.database.connect();
  }
}

function mapGeneration(row: GenerationRow): RuntimeSessionGeneration {
  return Object.freeze({
    id: row.id as RuntimeGenerationId,
    runtimeSessionId: row.runtime_session_id as RuntimeSessionId,
    generation: Number(row.generation),
    provider: row.provider,
    providerWorkspaceId: row.provider_workspace_id,
    providerSessionId: row.provider_session_id,
    appliedSpecRevision: Number(
      row.applied_spec_revision,
    ) as RuntimeSpecRevision,
    appliedBootstrapDigest: row.applied_bootstrap_digest,
    endpointEpoch: row.endpoint_epoch,
    status: row.status,
    createdAt: iso(row.created_at),
    readyAt: row.ready_at === null ? null : iso(row.ready_at),
    supersededAt: row.superseded_at === null ? null : iso(row.superseded_at),
    closedAt: row.closed_at === null ? null : iso(row.closed_at),
  });
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
