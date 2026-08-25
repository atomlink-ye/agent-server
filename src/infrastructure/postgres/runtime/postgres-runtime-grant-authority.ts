import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IssueRuntimeToolGrant } from '../../../application/ports/issue-runtime-tool-grant.js';
import type {
  RotateRuntimeGrant,
  RotateRuntimeGrantResult,
} from '../../../application/ports/rotate-runtime-grant.js';
import type { RuntimeGrantId } from '../../../domain/runtime/runtime-session.js';
import type { RevokeRuntimeGrants } from '../../../application/ports/revoke-runtime-grants.js';
import type { ReleaseRuntimeGrant } from '../../../application/ports/release-runtime-grant.js';
import type {
  RuntimeGenerationId,
  RuntimeSessionId,
  RuntimeTurnId,
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

// A turn is only "live" while it can still act on its grant. Every other
// status is terminal and can never call releaseForTurn/revokeForTurn again,
// so a grant left bound to one of those turns must be reclaimable rather
// than fenced forever.
const LIVE_TURN_STATUSES: ReadonlySet<string> = new Set([
  'preparing',
  'running',
]);

/** Writes only the 0056-shaped grant authority; bearer plaintext is returned once. */
export class PostgresRuntimeGrantAuthority
  implements
    IssueRuntimeToolGrant,
    RotateRuntimeGrant,
    RevokeRuntimeGrants,
    ReleaseRuntimeGrant
{
  public constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 15 * 60 * 1000,
  ) {}

  public async issue(input: Parameters<IssueRuntimeToolGrant['issue']>[0]) {
    const token = randomBytes(32).toString('base64url');
    const grantId = randomUUID() as RuntimeGrantId;
    const issuedAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    await this.database.query(
      `INSERT INTO runtime_tool_grants
       (id,runtime_session_id,generation_id,runtime_turn_id,token_hash,
        catalog_digest,allowed_tools,revision,expires_at,renewable_until,
        revoked_at,created_at,updated_at)
       VALUES($1,$2,$3,NULL,$4,$5,$6::jsonb,1,$7,NULL,NULL,$8,$8)`,
      [
        grantId,
        input.runtimeSessionId,
        input.generationId,
        hashToken(token),
        input.catalogDigest,
        JSON.stringify(input.allowedTools),
        expiresAt,
        issuedAt,
      ],
    );
    return { grantId, token };
  }

  public async revoke(grantId: RuntimeGrantId): Promise<void> {
    await this.database.query(
      `UPDATE runtime_tool_grants
          SET revoked_at=$2,updated_at=$2,revision=revision+1
        WHERE id=$1 AND revoked_at IS NULL`,
      [grantId, this.now().toISOString()],
    );
  }

  public revokeForGeneration(generationId: RuntimeGenerationId): Promise<void> {
    return this.revokeWhere('generation_id=$1', generationId);
  }

  public revokeForTurn(runtimeTurnId: RuntimeTurnId): Promise<void> {
    return this.revokeWhere('runtime_turn_id=$1', runtimeTurnId);
  }

  public releaseForTurn(runtimeTurnId: RuntimeTurnId): Promise<void> {
    return this.database
      .query(
        `UPDATE runtime_tool_grants
            SET runtime_turn_id=NULL,updated_at=$2,revision=revision+1
          WHERE runtime_turn_id=$1 AND revoked_at IS NULL`,
        [runtimeTurnId, this.now().toISOString()],
      )
      .then(() => undefined);
  }

  public revokeForSession(runtimeSessionId: RuntimeSessionId): Promise<void> {
    return this.revokeWhere('runtime_session_id=$1', runtimeSessionId);
  }

  public async execute(
    input: Parameters<RotateRuntimeGrant['execute']>[0],
  ): Promise<RotateRuntimeGrantResult> {
    const client = await this.transactionClient();
    const timestamp = this.now().toISOString();
    const nowMs = toEpochMillis(timestamp);
    try {
      await client.query('BEGIN');
      const turn = await client.query<{ readonly status: string }>(
        `SELECT status FROM runtime_turns
          WHERE id=$1 AND runtime_session_id=$2 AND generation_id=$3
          FOR UPDATE`,
        [input.runtimeTurnId, input.runtimeSessionId, input.generationId],
      );
      if (!turn.rows?.[0] || !LIVE_TURN_STATUSES.has(turn.rows[0].status)) {
        await client.query('ROLLBACK');
        return { kind: 'denied', reason: 'runtime_turn_not_active' };
      }
      // Join the bound turn's status in the same locked read: releaseForTurn
      // and revokeForTurn are in-process-only, so a grant can be left bound
      // to a turn that already finished (or died) without ever clearing
      // runtime_turn_id. Knowing that status here is what lets a dead
      // binding be reclaimed instead of fencing the generation forever.
      const grants = await client.query<{
        readonly id: string;
        readonly runtime_turn_id: string | null;
        readonly expires_at: string | Date;
        readonly bound_turn_status: string | null;
      }>(
        `SELECT g.id,g.runtime_turn_id,g.expires_at,t.status AS bound_turn_status
           FROM runtime_tool_grants g
           LEFT JOIN runtime_turns t ON t.id=g.runtime_turn_id
          WHERE g.runtime_session_id=$1 AND g.generation_id=$2
            AND g.revoked_at IS NULL
          ORDER BY g.created_at DESC FOR UPDATE OF g`,
        [input.runtimeSessionId, input.generationId],
      );
      const active = grants.rows?.filter(
        (grant) => toEpochMillis(grant.expires_at) > nowMs,
      );
      const current = active?.find(
        (grant) =>
          grant.runtime_turn_id === null ||
          grant.runtime_turn_id === input.runtimeTurnId,
      );
      const activeOther = active?.some(
        (grant) =>
          grant.runtime_turn_id !== null &&
          grant.runtime_turn_id !== input.runtimeTurnId &&
          LIVE_TURN_STATUSES.has(grant.bound_turn_status ?? ''),
      );
      // Reclaimable exactly like a NULL-turn bootstrap grant: either nothing
      // ever bound this grant to a turn, or the turn it was bound to is
      // terminal and will never call release/revoke for it again.
      const reclaimable = grants.rows?.find(
        (grant) =>
          grant.runtime_turn_id === null ||
          !LIVE_TURN_STATUSES.has(grant.bound_turn_status ?? ''),
      );
      const selected = current ?? (!activeOther ? reclaimable : undefined);
      if (!selected) {
        await client.query('ROLLBACK');
        return { kind: 'denied', reason: 'runtime_grant_rotation_fenced' };
      }
      await client.query(
        `UPDATE runtime_tool_grants
            SET revoked_at=$3,updated_at=$3,revision=revision+1
          WHERE runtime_session_id=$1 AND generation_id=$2
            AND id<>$4 AND revoked_at IS NULL`,
        [input.runtimeSessionId, input.generationId, timestamp, selected.id],
      );
      await client.query(
        `UPDATE runtime_tool_grants
            SET runtime_turn_id=$2,expires_at=$4,updated_at=$3,revision=revision+1
            WHERE id=$1 AND revoked_at IS NULL`,
        [
          selected.id,
          input.runtimeTurnId,
          timestamp,
          new Date(this.now().getTime() + this.ttlMs).toISOString(),
        ],
      );
      await client.query('COMMIT');
      return { kind: 'rotated' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async transactionClient(): Promise<Client> {
    if (
      !('connect' in this.database) ||
      typeof this.database.connect !== 'function'
    )
      throw new Error(
        'Runtime grant rotation requires a Postgres transaction client.',
      );
    return this.database.connect();
  }

  private async revokeWhere(predicate: string, id: string): Promise<void> {
    const timestamp = this.now().toISOString();
    await this.database.query(
      `UPDATE runtime_tool_grants
          SET revoked_at=$2,updated_at=$2,revision=revision+1
        WHERE ${predicate} AND revoked_at IS NULL`,
      [id, timestamp],
    );
  }
}

// node-postgres parses timestamptz into a Date, but that is a driver/type-
// parser detail, not a contract. Compare instants numerically so a change in
// either shape (or a driver upgrade) cannot silently reclassify every grant
// as expired.
function toEpochMillis(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
