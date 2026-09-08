import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

import type { WorkspaceMembershipRepository } from '../ports/workspace-membership-repository.js';
import type {
  AuthRepository,
  AuthSession,
  AuthUser,
} from '../ports/auth-repository.js';

const PASSWORD_BYTES = 64;
const SCRYPT = Object.freeze({ N: 32_768, r: 8, p: 3 });
const DUMMY_SALT = 'agent-server-auth-dummy-salt';

function scrypt(
  password: string,
  salt: string,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      keyLength,
      { ...SCRYPT, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });
}
const SESSION_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthFailure =
  'invalid_credentials' | 'username_taken' | 'invalid_input';

export class AuthError extends Error {
  public constructor(readonly code: AuthFailure) {
    super(code);
    this.name = 'AuthError';
  }
}

export interface AuthIdentity {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly tenantId: string;
  readonly workspaceId: string;
}

export class AuthService {
  public constructor(
    private readonly repository: AuthRepository,
    private readonly workspaceMembers: WorkspaceMembershipRepository,
    private readonly scope: {
      readonly tenantId: string;
      readonly workspaceId: string;
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async register(
    username: string,
    password: string,
  ): Promise<{ identity: AuthIdentity; token: string }> {
    const normalized = normalizeUsername(username);
    validatePassword(password);
    const userId = randomUUID();
    const displayName = normalized;
    let user: AuthUser;
    try {
      user = await this.repository.createUser({
        id: userId,
        username: normalized,
        displayName,
        passwordHash: await hashPassword(password),
        tenantId: this.scope.tenantId,
        workspaceId: this.scope.workspaceId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AuthError('username_taken');
      throw error;
    }
    await this.workspaceMembers.ensureMember({
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      principalType: 'user',
      principalId: user.id,
      displayName: user.displayName,
    });
    return this.issue(user);
  }

  public async login(
    username: string,
    password: string,
  ): Promise<{ identity: AuthIdentity; token: string }> {
    const normalized = normalizeUsername(username);
    validatePassword(password);
    const user = await this.repository.findUserByUsername(normalized);
    if (!user) {
      await scrypt(password, DUMMY_SALT, PASSWORD_BYTES);
      throw new AuthError('invalid_credentials');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new AuthError('invalid_credentials');
    }
    return this.issue(user);
  }

  public async resolve(token: string): Promise<AuthSession | null> {
    if (!token || token.length > 256) return null;
    return this.repository.findSession(hashToken(token));
  }

  public async logout(token: string): Promise<void> {
    if (token) await this.repository.revokeSession(hashToken(token));
  }

  private async issue(
    user: AuthUser,
  ): Promise<{ identity: AuthIdentity; token: string }> {
    const token = randomBytes(SESSION_BYTES).toString('base64url');
    await this.repository.createSession({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS).toISOString(),
    });
    return { identity: identity(user), token };
  }
}

function identity(user: AuthUser): AuthIdentity {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
  };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const key = await scrypt(password, salt, PASSWORD_BYTES);
  return `scrypt$v=1$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${salt}$${key.toString('base64url')}`;
}

async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, version, parameters, salt, value] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    version !== 'v=1' ||
    !parameters ||
    !salt ||
    !value
  )
    return false;
  const parsed = parseParameters(parameters);
  if (!parsed) return false;
  try {
    const expected = Buffer.from(value, 'base64url');
    if (expected.length !== PASSWORD_BYTES) return false;
    const actual = await derive(password, salt, expected.length, parsed);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

function parseParameters(
  value: string,
): { readonly N: number; readonly r: number; readonly p: number } | null {
  const match = /^N=(\d+),r=(\d+),p=(\d+)$/u.exec(value);
  if (!match) return null;
  const N = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  if (
    !Number.isSafeInteger(N) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    N < 16_384 ||
    N > 262_144 ||
    (N & (N - 1)) !== 0 ||
    r < 1 ||
    r > 32 ||
    p < 1 ||
    p > 8
  )
    return null;
  return { N, r, p };
}

function derive(
  password: string,
  salt: string,
  keyLength: number,
  parameters: { readonly N: number; readonly r: number; readonly p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      keyLength,
      { ...parameters, maxmem: 128 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key as Buffer)),
    ),
  );
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeUsername(value: string): string {
  if (typeof value !== 'string') throw new AuthError('invalid_input');
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(normalized))
    throw new AuthError('invalid_input');
  return normalized;
}

function validatePassword(value: string): void {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256)
    throw new AuthError('invalid_input');
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === '23505',
  );
}
