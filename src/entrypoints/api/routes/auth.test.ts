import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type {
  AuthRepository,
  AuthSession,
  AuthUser,
} from '../../../application/ports/auth-repository.js';
import type { WorkspaceMembershipRepository } from '../../../application/ports/workspace-membership-repository.js';
import { AuthService } from '../../../application/auth/auth-service.js';
import { registerAuthRoutes, requireBrowserSession } from './auth.js';
import type { ApiEnvironment } from '../http-types.js';

class Repo implements AuthRepository {
  user: AuthUser | null = null;
  session: AuthSession | null = null;
  hash = '';
  async createUser(input: Parameters<AuthRepository['createUser']>[0]) {
    this.user = { ...input };
    return this.user;
  }
  async findUserByUsername(username: string) {
    return this.user?.username === username ? this.user : null;
  }
  async createSession(input: Parameters<AuthRepository['createSession']>[0]) {
    this.hash = input.tokenHash;
    this.session = {
      userId: this.user!.id,
      username: this.user!.username,
      displayName: this.user!.displayName,
      tenantId: this.user!.tenantId,
      workspaceId: this.user!.workspaceId,
      expiresAt: input.expiresAt,
    };
  }
  async findSession(hash: string) {
    return hash === this.hash &&
      this.session &&
      Date.parse(this.session.expiresAt) > Date.now()
      ? this.session
      : null;
  }
  async revokeSession() {
    this.session = null;
  }
}

function app(repo: Repo) {
  const members: WorkspaceMembershipRepository = {
    ensureMember: async () => undefined,
    findDisplayNames: async () => new Map(),
    setDisplayName: async () => true,
  };
  const service = new AuthService(repo, members, {
    tenantId: 'tenant',
    workspaceId: '11111111-1111-4111-8111-111111111111',
  });
  const value = new Hono<ApiEnvironment>();
  registerAuthRoutes(value, service);
  return value;
}

describe('HTTP auth routes', () => {
  it('register auto-logs in with an HttpOnly cookie and logout revokes it', async () => {
    const repo = new Repo();
    const server = app(repo);
    const registered = await server.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'maya',
        password: 'correct horse battery staple',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(registered.status).toBe(201);
    expect(registered.headers.get('set-cookie')).toMatch(
      /agent_server_session=.*HttpOnly.*SameSite=Lax/u,
    );
    expect(await registered.text()).not.toContain('correct horse');
    const cookie = registered.headers.get('set-cookie')!.split(';')[0]!;
    expect(
      (await server.request('/api/auth/me', { headers: { cookie } })).status,
    ).toBe(200);
    repo.session = { ...repo.session!, expiresAt: '2000-01-01T00:00:00.000Z' };
    expect(
      (await server.request('/api/auth/me', { headers: { cookie } })).status,
    ).toBe(401);
    const loggedOut = await server.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie },
    });
    expect(loggedOut.status).toBe(204);
    expect(
      (await server.request('/api/auth/me', { headers: { cookie } })).status,
    ).toBe(401);
  });

  it('requires the session for browser routes and ignores a spoofed identity header', async () => {
    const repo = new Repo();
    const server = app(repo);
    const registered = await server.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'maya',
        password: 'correct horse battery staple',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const cookie = registered.headers.get('set-cookie')!.split(';')[0]!;
    const guarded = new Hono<ApiEnvironment>();
    const service = new AuthService(
      repo,
      {
        ensureMember: async () => undefined,
        findDisplayNames: async () => new Map(),
        setDisplayName: async () => true,
      },
      {
        tenantId: 'tenant',
        workspaceId: '11111111-1111-4111-8111-111111111111',
      },
    );
    guarded.use('/api/*', requireBrowserSession(service));
    guarded.get('/api/private', (c) =>
      c.json({ user: c.get('browserUserId') }),
    );
    expect((await guarded.request('/api/private')).status).toBe(401);
    const response = await guarded.request('/api/private', {
      headers: { cookie, 'x-agent-server-user-id': 'attacker' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: repo.user!.id });
  });
});
