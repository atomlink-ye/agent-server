import { apiTransport } from '../../api/transport';

export interface AuthIdentity {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
}

export async function loadAuthIdentity(): Promise<AuthIdentity> {
  return parseAuth(await apiTransport.request('/api/auth/me'));
}
export async function login(
  username: string,
  password: string,
): Promise<AuthIdentity> {
  return parseAuth(
    await apiTransport.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  );
}
export async function register(
  username: string,
  password: string,
): Promise<AuthIdentity> {
  return parseAuth(
    await apiTransport.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  );
}
export async function logout(): Promise<void> {
  await apiTransport.request('/api/auth/logout', { method: 'POST' });
}
function parseAuth(value: unknown): AuthIdentity {
  const payload = record(value);
  if (!payload) throw new Error('Invalid authentication response.');
  return {
    userId: text(payload.user_id),
    username: text(payload.username),
    displayName: text(payload.display_name),
  };
}

export interface Account {
  readonly principalId: string;
  readonly principalType: string;
  readonly displayName: string | null;
}

export async function loadAccount(): Promise<Account> {
  const payload = record(await apiTransport.request('/api/account'));
  if (!payload) throw new Error('Invalid account response.');
  return {
    principalId: text(payload.principal_id),
    principalType: text(payload.principal_type),
    displayName: nullableText(payload.display_name),
  };
}

export async function setDisplayName(displayName: string): Promise<string> {
  const payload = record(
    await apiTransport.request('/api/account/display-name', {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    }),
  );
  if (!payload) throw new Error('Invalid display name response.');
  return text(payload.display_name);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Invalid account response.');
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}
