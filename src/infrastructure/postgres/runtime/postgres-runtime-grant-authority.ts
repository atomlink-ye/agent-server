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
    try {
      await client.query('BEGIN');
      const turn = await client.query<{ readonly status: string }>(
        `SELECT status FROM runtime_turns
          WHERE id=$1 AND runtime_session_id=$2 AND generation_id=$3
          FOR UPDATE`,
        [input.runtimeTurnId, input.runtimeSessionId, input.generationId],
      );
      if (
        !turn.rows?.[0] ||
        !['preparing', 'running'].includes(turn.rows[0].status)
      ) {
        await client.query('ROLLBACK');
        return { kind: 'denied', reason: 'runtime_turn_not_active' };
      }
      const grants = await client.query<{
        readonly id: string;
        readonly runtime_turn_id: string | null;
        readonly expires_at: string | Date;
      }>(
        `SELECT id,runtime_turn_id,expires_at FROM runtime_tool_grants
          WHERE runtime_session_id=$1 AND generation_id=$2
            AND revoked_at IS NULL
          ORDER BY created_at DESC FOR UPDATE`,
        [input.runtimeSessionId, input.generationId],
      );
      const active = grants.rows?.filter(
        (grant) => dateValue(grant.expires_at) > timestamp,
      );
      const current = active?.find(
        (grant) =>
          grant.runtime_turn_id === null ||
          grant.runtime_turn_id === input.runtimeTurnId,
      );
      const activeOther = active?.some(
        (grant) =>
          grant.runtime_turn_id !== null &&
          grant.runtime_turn_id !== input.runtimeTurnId,
      );
      const bootstrapLineage = grants.rows?.find(
        (grant) => grant.runtime_turn_id === null,
      );
      const selected = current ?? (!activeOther ? bootstrapLineage : undefined);
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

function dateValue(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
