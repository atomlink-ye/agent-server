import { randomUUID } from 'node:crypto';

import type { RuntimeTurnStore } from '../../../application/ports/runtime-turn-store.js';
import type {
  RuntimeFailureCode,
  RuntimeTurn,
  RuntimeTurnId,
  RuntimeTurnSource,
  RuntimeTurnStatus,
} from '../../../domain/runtime/runtime-turn.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
} from '../../../domain/runtime/runtime-session.js';

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

interface RuntimeTurnRow extends Record<string, unknown> {
  readonly id: string;
  readonly runtime_session_id: string;
  readonly generation_id: string | null;
  readonly source_kind: string;
  readonly source_id: string;
  readonly source_context: unknown;
  readonly status: RuntimeTurnStatus;
  readonly prompt_digest: string | null;
  readonly failure_code: RuntimeFailureCode | null;
  readonly created_at: string | Date;
  readonly started_at: string | Date | null;
  readonly completed_at: string | Date | null;
}

const TURN_COLUMNS = `id,runtime_session_id,generation_id,source_kind,source_id,
  source_context,status,prompt_digest,failure_code,created_at,started_at,completed_at`;

export class PostgresRuntimeTurnStore implements RuntimeTurnStore {
  public constructor(private readonly database: Database) {}

  public async createPending(input: {
    readonly id?: RuntimeTurnId;
    readonly runtimeSessionId: RuntimeSessionId;
    readonly source: RuntimeTurnSource;
    readonly promptDigest: string | null;
    readonly createdAt: string;
  }): Promise<RuntimeTurn> {
    const id = input.id ?? (randomUUID() as RuntimeTurnId);
    const source = encodeSource(input.source);
    const result = await this.database.query<RuntimeTurnRow>(
      `INSERT INTO runtime_turns
       (id,runtime_session_id,generation_id,source_kind,source_id,
        source_context,status,prompt_digest,failure_code,created_at,started_at,completed_at)
       VALUES($1,$2,NULL,$3,$4,$5::jsonb,'pending',$6,NULL,$7,NULL,NULL)
       ON CONFLICT (id) DO UPDATE SET id=runtime_turns.id
       WHERE runtime_turns.runtime_session_id=$2
         AND runtime_turns.source_kind=$3
         AND runtime_turns.source_id=$4
         AND runtime_turns.source_context=$5::jsonb
       RETURNING ${TURN_COLUMNS}`,
      [
        id,
        input.runtimeSessionId,
        source.kind,
        source.id,
        JSON.stringify(source.context),
        input.promptDigest,
        input.createdAt,
      ],
    );
    const created = result.rows?.[0];
    if (created) return mapTurn(created);

    const existing = await this.database.query<RuntimeTurnRow>(
      `SELECT ${TURN_COLUMNS} FROM runtime_turns WHERE id=$1`,
      [id],
    );
    const turn = existing.rows?.[0];
    if (!turn) throw new Error('Runtime turn could not be created.');
    if (
      turn.runtime_session_id !== input.runtimeSessionId ||
      turn.source_kind !== source.kind ||
      turn.source_id !== source.id ||
      JSON.stringify(objectContext(turn.source_context)) !==
        JSON.stringify(source.context)
    )
      throw new Error('Runtime turn identity conflict.');
    return mapTurn(turn);
  }

  public async findById(id: RuntimeTurnId): Promise<RuntimeTurn | null> {
    const result = await this.database.query<RuntimeTurnRow>(
      `SELECT ${TURN_COLUMNS} FROM runtime_turns WHERE id=$1`,
      [id],
    );
    return result.rows?.[0] ? mapTurn(result.rows[0]) : null;
  }

  public async bindGenerationAndPrepare(input: {
    readonly id: RuntimeTurnId;
    readonly generationId: RuntimeGenerationId;
    readonly promptDigest: string;
  }): Promise<RuntimeTurn | false> {
    const database = await this.transactionClient();
    try {
      await database.query('BEGIN');
      const turnIdentityResult = await database.query<{
        readonly runtime_session_id: string;
      }>(`SELECT runtime_session_id FROM runtime_turns WHERE id=$1`, [
        input.id,
      ]);
      const turnIdentity = turnIdentityResult.rows?.[0];
      if (!turnIdentity) {
        await database.query('ROLLBACK');
        return false;
      }

      const session = await database.query<{
        readonly id: string;
        readonly current_generation_id: string | null;
      }>(
        `SELECT id,current_generation_id
           FROM runtime_sessions
          WHERE id=$1
          FOR UPDATE`,
        [turnIdentity.runtime_session_id],
      );
      const lockedSession = session.rows?.[0];
      if (
        !lockedSession ||
        lockedSession.current_generation_id !== input.generationId
      ) {
        await database.query('ROLLBACK');
        return false;
      }

      const generationResult = await database.query<{
        readonly runtime_session_id: string;
        readonly status: string;
      }>(
        `SELECT runtime_session_id,status
           FROM runtime_session_generations
          WHERE id=$1`,
        [input.generationId],
      );
      const generation = generationResult.rows?.[0];
      if (
        !generation ||
        generation.runtime_session_id !== turnIdentity.runtime_session_id ||
        generation.status !== 'active'
      ) {
        await database.query('ROLLBACK');
        return false;
      }

      const turnResult = await database.query<RuntimeTurnRow>(
        `SELECT ${TURN_COLUMNS} FROM runtime_turns WHERE id=$1 FOR UPDATE`,
        [input.id],
      );
      const turn = turnResult.rows?.[0];
      if (!turn || turn.status !== 'pending') {
        await database.query('ROLLBACK');
        return false;
      }

      const busy = await database.query(
        `SELECT id
           FROM runtime_turns
          WHERE runtime_session_id=$1
            AND status IN ('preparing','running')
            AND id <> $2
          LIMIT 1
          FOR UPDATE`,
        [turnIdentity.runtime_session_id, input.id],
      );
      if ((busy.rows?.length ?? 0) > 0) {
        await database.query('ROLLBACK');
        return false;
      }

      const updated = await database.query<RuntimeTurnRow>(
        `UPDATE runtime_turns
            SET generation_id=$2,prompt_digest=$3,status='preparing'
          WHERE id=$1 AND status='pending'
          RETURNING ${TURN_COLUMNS}`,
        [input.id, input.generationId, input.promptDigest],
      );
      const prepared = updated.rows?.[0];
      if (!prepared) {
        await database.query('ROLLBACK');
        return false;
      }
      await database.query('COMMIT');
      return mapTurn(prepared);
    } catch (error) {
      await database.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      database.release();
    }
  }

  public start(input: {
    readonly id: RuntimeTurnId;
    readonly startedAt: string;
  }): Promise<RuntimeTurn | false> {
    return this.transition(
      input.id,
      ['preparing'],
      `started_at=$2,status='running'`,
      [input.startedAt],
    );
  }

  public succeed(input: {
    readonly id: RuntimeTurnId;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false> {
    return this.transition(
      input.id,
      ['running'],
      `status='succeeded',completed_at=$2`,
      [input.completedAt],
    );
  }

  public fail(input: {
    readonly id: RuntimeTurnId;
    readonly failureCode: RuntimeFailureCode;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false> {
    return this.transition(
      input.id,
      ['pending', 'preparing', 'running'],
      `status='failed',failure_code=$2,completed_at=$3`,
      [input.failureCode, input.completedAt],
    );
  }

  public cancelBeforeRun(input: {
    readonly id: RuntimeTurnId;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false> {
    return this.transition(
      input.id,
      ['pending', 'preparing'],
      `status='cancelled',failure_code='runtime_turn_cancelled',completed_at=$2`,
      [input.completedAt],
    );
  }

  public cancelRunning(input: {
    readonly id: RuntimeTurnId;
    readonly completedAt: string;
  }): Promise<RuntimeTurn | false> {
    return this.transition(
      input.id,
      ['running'],
      `status='cancelled',failure_code='runtime_turn_cancelled',completed_at=$2`,
      [input.completedAt],
    );
  }

  private async transition(
    id: RuntimeTurnId,
    expectedStatuses: readonly RuntimeTurnStatus[],
    setClause: string,
    values: readonly unknown[],
  ): Promise<RuntimeTurn | false> {
    const result = await this.database.query<RuntimeTurnRow>(
      `UPDATE runtime_turns
          SET ${setClause}
        WHERE id=$1 AND status = ANY($${values.length + 2}::text[])
      RETURNING ${TURN_COLUMNS}`,
      [id, ...values, expectedStatuses],
    );
    const row = result.rows?.[0];
    return row ? mapTurn(row) : false;
  }

  private async transactionClient(): Promise<Client> {
    if (
      !('connect' in this.database) ||
      typeof this.database.connect !== 'function'
    )
      throw new Error(
        'Runtime turn preparation requires a Postgres transaction client.',
      );
    return this.database.connect();
  }
}

function encodeSource(source: RuntimeTurnSource): {
  readonly kind: string;
  readonly id: string;
  readonly context: Record<string, string>;
} {
  if (source.kind === 'run')
    return { kind: 'run', id: source.runId, context: {} };
  if (source.kind === 'conversation')
    return {
      kind: 'conversation',
      id: source.conversationId,
      context: { triggerMessageId: source.triggerMessageId },
    };
  return {
    kind: 'team_member',
    id: source.teamMemberRunId,
    context: { taskId: source.taskId, runId: source.runId },
  };
}

function mapTurn(row: RuntimeTurnRow): RuntimeTurn {
  return Object.freeze({
    id: row.id as RuntimeTurnId,
    runtimeSessionId: row.runtime_session_id as RuntimeSessionId,
    generationId: row.generation_id as RuntimeGenerationId | null,
    source: decodeSource(row),
    status: row.status,
    promptDigest: row.prompt_digest,
    failureCode: row.failure_code,
    createdAt: iso(row.created_at),
    startedAt: row.started_at === null ? null : iso(row.started_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
  });
}

function decodeSource(row: RuntimeTurnRow): RuntimeTurnSource {
  const context = objectContext(row.source_context);
  if (row.source_kind === 'run') {
    if (Object.keys(context).length !== 0)
      throw new Error('Runtime run turn source is invalid.');
    return { kind: 'run', runId: row.source_id };
  }
  if (row.source_kind === 'conversation') {
    const triggerMessageId = context.triggerMessageId;
    if (
      !triggerMessageId ||
      Object.keys(context).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(context, 'triggerMessageId')
    )
      throw new Error('Runtime conversation turn source is invalid.');
    return {
      kind: 'conversation',
      conversationId: row.source_id,
      triggerMessageId,
    };
  }
  if (row.source_kind === 'team_member') {
    const taskId = context.taskId;
    const runId = context.runId;
    if (
      !taskId ||
      !runId ||
      Object.keys(context).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(context, 'taskId') ||
      !Object.prototype.hasOwnProperty.call(context, 'runId')
    )
      throw new Error('Runtime team-member turn source is invalid.');
    return {
      kind: 'team_member',
      teamMemberRunId: row.source_id,
      taskId,
      runId,
    };
  }
  throw new Error('Runtime turn source kind is invalid.');
}

function objectContext(value: unknown): Record<string, string> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Runtime turn source context is invalid.');
  const context = parsed as Record<string, unknown>;
  for (const item of Object.values(context))
    if (typeof item !== 'string')
      throw new Error('Runtime turn source context is invalid.');
  return context as Record<string, string>;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
