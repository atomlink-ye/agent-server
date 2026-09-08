import { describe, expect, it } from 'vitest';
import type {
  AuthRepository,
  AuthSession,
  AuthUser,
} from '../ports/auth-repository.js';
import type { WorkspaceMembershipRepository } from '../ports/workspace-membership-repository.js';
import { AuthError, AuthService } from './auth-service.js';

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUser>();
  readonly sessions = new Map<string, AuthSession>();
  async createUser(
    input: Parameters<AuthRepository['createUser']>[0],
  ): Promise<AuthUser> {
    if (this.users.has(input.username))
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    const user = { ...input };
    this.users.set(user.username, user);
    return user;
  }
  async findUserByUsername(username: string) {
    return this.users.get(username) ?? null;
  }
  async createSession(input: Parameters<AuthRepository['createSession']>[0]) {
    const user = [...this.users.values()].find(
      (candidate) => candidate.id === input.userId,
    )!;
    this.sessions.set(input.tokenHash, {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      expiresAt: input.expiresAt,
    });
  }
  async findSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async revokeSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

function members(): WorkspaceMembershipRepository & { rows: unknown[] } {
  return {
    rows: [],
    async ensureMember(input) {
      this.rows.push(input);
    },
    async findDisplayNames() {
      return new Map();
    },
    async setDisplayName() {
      return true;
    },
  };
}

describe('AuthService', () => {
  it('registers, auto-logs in, and stores only a scrypt record', async () => {
    const repository = new MemoryAuthRepository();
    const membership = members();
    const service = new AuthService(repository, membership, {
      tenantId: 'tenant',
      workspaceId: '11111111-1111-4111-8111-111111111111',
    });
    const result = await service.register(
      'Maya',
      'correct horse battery staple',
    );
    expect(result.identity.username).toBe('maya');
    expect(result.token).not.toContain('correct');
    expect([...repository.users.values()][0]?.passwordHash).toMatch(
      /^scrypt\$/u,
    );
    expect([...repository.users.values()][0]?.passwordHash).not.toContain(
      'correct horse battery staple',
    );
    expect(membership.rows).toHaveLength(1);
    await expect(service.login('maya', 'wrong password')).rejects.toMatchObject(
      { code: 'invalid_credentials' },
    );
    expect(await service.resolve(result.token)).toMatchObject({
      username: 'maya',
    });
  });

  it('rejects duplicate usernames', async () => {
    const repository = new MemoryAuthRepository();
    const service = new AuthService(repository, members(), {
      tenantId: 'tenant',
      workspaceId: '11111111-1111-4111-8111-111111111111',
    });
    await service.register('maya', 'correct horse battery staple');
    await expect(
      service.register('MAYA', 'correct horse battery staple'),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
