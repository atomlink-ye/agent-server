import type {
  AuthRepository,
  AuthSession,
  AuthUser,
} from '../../application/ports/auth-repository.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

export class PostgresAuthRepository implements AuthRepository {
  public constructor(private readonly db: Queryable) {}

  public async createUser(
    input: Parameters<AuthRepository['createUser']>[0],
  ): Promise<AuthUser> {
    const result = await this.db.query<AuthUser>(
      `INSERT INTO auth_users (id,username,display_name,password_hash,tenant_id,workspace_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING id,username,display_name AS "displayName",password_hash AS "passwordHash",tenant_id AS "tenantId",workspace_id AS "workspaceId"`,
      [
        input.id,
        input.username,
        input.displayName,
        input.passwordHash,
        input.tenantId,
        input.workspaceId,
        new Date().toISOString(),
      ],
    );
    return (
      result.rows?.[0] ??
      (() => {
        throw new Error('auth_user_create_failed');
      })()
    );
  }

  public async findUserByUsername(username: string): Promise<AuthUser | null> {
    const result = await this.db.query<AuthUser>(
      `SELECT id,username,display_name AS "displayName",password_hash AS "passwordHash",tenant_id AS "tenantId",workspace_id AS "workspaceId"
         FROM auth_users WHERE username=$1`,
      [username],
    );
    return result.rows?.[0] ?? null;
  }

  public async createSession(
    input: Parameters<AuthRepository['createSession']>[0],
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO auth_sessions (token_hash,user_id,expires_at,created_at) VALUES ($1,$2,$3,$4)`,
      [
        input.tokenHash,
        input.userId,
        input.expiresAt,
        new Date().toISOString(),
      ],
    );
  }

  public async findSession(tokenHash: string): Promise<AuthSession | null> {
    const result = await this.db.query<AuthSession>(
      `SELECT s.user_id AS "userId",u.username,u.display_name AS "displayName",u.tenant_id AS "tenantId",u.workspace_id AS "workspaceId",s.expires_at AS "expiresAt"
         FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [tokenHash],
    );
    return result.rows?.[0] ?? null;
  }

  public async revokeSession(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }
}
