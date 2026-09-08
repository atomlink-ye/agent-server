import type { Context, Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  AuthError,
  type AuthService,
} from '../../../application/auth/auth-service.js';
import {
  AuthCredentialsSchema,
  AuthIdentitySchema,
} from '../../../contracts/auth.js';
import type { ApiEnvironment } from '../http-types.js';

export const AUTH_COOKIE = 'agent_server_session';

export function requireBrowserSession(
  auth: AuthService,
): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const path = context.req.path;
    if (path.startsWith('/api/v1/') || path.startsWith('/api/auth/')) {
      await next();
      return;
    }
    const token = readCookie(context.req.header('cookie'));
    const session = token ? await auth.resolve(token) : null;
    if (!session) {
      context.header('cache-control', 'no-store');
      return context.json(
        {
          error: {
            code: 'unauthorized',
            message: 'Authentication is required.',
          },
        },
        401,
      );
    }
    context.set('browserUserId', session.userId);
    await next();
  };
}

export function registerAuthRoutes(
  app: Hono<ApiEnvironment>,
  auth: AuthService,
): void {
  app.post('/api/auth/register', (c) => credentials(c, auth, 'register'));
  app.post('/api/auth/login', (c) => credentials(c, auth, 'login'));
  app.get('/api/auth/me', async (c) => {
    const session = await auth.resolve(
      readCookie(c.req.header('cookie')) ?? '',
    );
    if (!session) return unauthorized(c);
    return c.json(identity(session));
  });
  app.post('/api/auth/logout', async (c) => {
    const token = readCookie(c.req.header('cookie'));
    if (token) await auth.logout(token);
    c.header('set-cookie', clearCookie());
    return c.body(null, 204);
  });
}

async function credentials(
  c: Context<ApiEnvironment>,
  auth: AuthService,
  operation: 'register' | 'login',
): Promise<Response> {
  const parsed = AuthCredentialsSchema.safeParse(
    await c.req.json().catch(() => undefined),
  );
  if (!parsed.success)
    return c.json(
      {
        error: {
          code: 'invalid_request',
          message: 'Username or password is invalid.',
        },
      },
      400,
    );
  try {
    const result =
      operation === 'register'
        ? await auth.register(parsed.data.username, parsed.data.password)
        : await auth.login(parsed.data.username, parsed.data.password);
    c.header('set-cookie', sessionCookie(result.token));
    return c.json(
      identity(result.identity),
      operation === 'register' ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.code === 'username_taken'
          ? 409
          : error.code === 'invalid_credentials'
            ? 401
            : 400;
      return c.json(
        {
          error: {
            code: error.code,
            message:
              error.code === 'invalid_credentials'
                ? 'Username or password is incorrect.'
                : 'Username or password is invalid.',
          },
        },
        status,
      );
    }
    throw error;
  }
}

export function readCookie(header: string | undefined): string | null {
  const match = header
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${AUTH_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(AUTH_COOKIE.length + 1)) : null;
}

function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}
function clearCookie(): string {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function identity(value: {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
}): z.infer<typeof AuthIdentitySchema> {
  return AuthIdentitySchema.parse({
    user_id: value.userId,
    username: value.username,
    display_name: value.displayName,
  });
}
function unauthorized(c: Context<ApiEnvironment>): Response {
  return c.json(
    { error: { code: 'unauthorized', message: 'Authentication is required.' } },
    401,
  );
}
