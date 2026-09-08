export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface AuthSession {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly expiresAt: string;
}

export interface AuthRepository {
  createUser(input: {
    readonly id: string;
    readonly username: string;
    readonly displayName: string;
    readonly passwordHash: string;
    readonly tenantId: string;
    readonly workspaceId: string;
  }): Promise<AuthUser>;
  findUserByUsername(username: string): Promise<AuthUser | null>;
  createSession(input: {
    readonly tokenHash: string;
    readonly userId: string;
    readonly expiresAt: string;
  }): Promise<void>;
  findSession(tokenHash: string): Promise<AuthSession | null>;
  revokeSession(tokenHash: string): Promise<void>;
}
