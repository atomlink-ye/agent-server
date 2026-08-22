import type {
  PersistedRuntimeToolGrant,
  RuntimeToolGrantPersistence,
} from '../../application/ports/runtime-tool-grant-persistence.js';
import type {
  RuntimeActiveTurn,
  RuntimeToolChatContext,
} from '../../application/extensions/runtime-tool-grant-service.js';

export interface RuntimeGrantDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface GrantRow extends Record<string, unknown> {
  readonly id: string;
  readonly token_hash: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly product_session_id: string | null;
  readonly scope_id: string;
  readonly team_member_run_id: string | null;
  readonly team_run_id: string | null;
  readonly allowed_tools: unknown;
  readonly catalog_tools: unknown;
  readonly active_turn: unknown;
  readonly chat_context: unknown;
  readonly expires_at: string | Date;
  readonly renewable_until: string | Date | null;
  readonly revision: number;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresRuntimeToolGrantPersistence implements RuntimeToolGrantPersistence {
  public constructor(private readonly database: RuntimeGrantDatabase) {}

  public async loadRecoverable(
    now: string,
  ): Promise<readonly PersistedRuntimeToolGrant[]> {
    const result = await this.database.query<GrantRow>(
      `SELECT id, token_hash, tenant_id, workspace_id, principal_type,
              principal_id, product_session_id, scope_id, team_member_run_id,
              team_run_id, allowed_tools, catalog_tools, active_turn,
              chat_context, expires_at, renewable_until, revision,
              created_at, updated_at
         FROM runtime_tool_grants
        WHERE revoked_at IS NULL
          AND (expires_at > $1 OR renewable_until > $1)
        ORDER BY created_at, id`,
      [now],
    );
    return Object.freeze((result.rows ?? []).map(mapGrant));
  }

  public async save(grant: PersistedRuntimeToolGrant): Promise<void> {
    await this.database.query(
      `INSERT INTO runtime_tool_grants (
         id, token_hash, tenant_id, workspace_id, principal_type, principal_id,
         product_session_id, scope_id, team_member_run_id, team_run_id,
         allowed_tools, catalog_tools, active_turn, chat_context, expires_at,
         renewable_until, revoked_at, revision, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,NULL,$17,$18,$19
       )
       ON CONFLICT (id) DO UPDATE SET
         allowed_tools = EXCLUDED.allowed_tools,
         catalog_tools = EXCLUDED.catalog_tools,
         active_turn = EXCLUDED.active_turn,
         chat_context = EXCLUDED.chat_context,
         expires_at = EXCLUDED.expires_at,
         renewable_until = EXCLUDED.renewable_until,
         revision = EXCLUDED.revision,
         updated_at = EXCLUDED.updated_at,
         revoked_at = NULL`,
      [
        grant.grantId,
        grant.tokenHashHex,
        grant.tenantId,
        grant.workspaceId,
        grant.principalType,
        grant.principalId,
        grant.productSessionId ?? null,
        grant.scopeId,
        grant.teamMemberRunId ?? null,
        grant.teamRunId ?? null,
        JSON.stringify(grant.allowedTools),
        JSON.stringify(grant.catalogTools),
        grant.activeTurn ? JSON.stringify(grant.activeTurn) : null,
        grant.chatContext ? JSON.stringify(grant.chatContext) : null,
        grant.expiresAt,
        grant.renewableUntil ?? null,
        grant.revision,
        grant.createdAt,
        grant.updatedAt,
      ],
    );
  }

  public async revoke(grantId: string, revokedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE runtime_tool_grants
          SET revoked_at=$2, updated_at=$2, revision=revision+1
        WHERE id=$1 AND revoked_at IS NULL`,
      [grantId, revokedAt],
    );
  }

  public async revokeForTeamRun(
    teamRunId: string,
    revokedAt: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE runtime_tool_grants
          SET revoked_at=$2, updated_at=$2, revision=revision+1
        WHERE team_run_id=$1 AND revoked_at IS NULL`,
      [teamRunId, revokedAt],
    );
  }
}

function mapGrant(row: GrantRow): PersistedRuntimeToolGrant {
  return Object.freeze({
    grantId: row.id,
    tokenHashHex: row.token_hash,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    ...(row.product_session_id
      ? { productSessionId: row.product_session_id }
      : {}),
    scopeId: row.scope_id,
    ...(row.team_member_run_id
      ? { teamMemberRunId: row.team_member_run_id }
      : {}),
    ...(row.team_run_id ? { teamRunId: row.team_run_id } : {}),
    allowedTools: Object.freeze(
      stringArray(row.allowed_tools, 'allowed_tools'),
    ),
    catalogTools: Object.freeze(
      stringArray(row.catalog_tools, 'catalog_tools'),
    ),
    activeTurn: objectOrNull<RuntimeActiveTurn>(row.active_turn, 'active_turn'),
    ...(row.chat_context
      ? {
          chatContext: objectOrNull<RuntimeToolChatContext>(
            row.chat_context,
            'chat_context',
          )!,
        }
      : {}),
    expiresAt: iso(row.expires_at),
    ...(row.renewable_until
      ? { renewableUntil: iso(row.renewable_until) }
      : {}),
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`Invalid persisted runtime grant ${field}.`);
  return [...value];
}

function objectOrNull<T>(value: unknown, field: string): T | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid persisted runtime grant ${field}.`);
  return value as T;
}

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error('Invalid persisted runtime grant timestamp.');
  return parsed.toISOString();
}
