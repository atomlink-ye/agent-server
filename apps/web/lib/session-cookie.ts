import 'server-only';
import { cookies } from 'next/headers';

export const productSessionCookie = 'product_session_id';

export async function readProductSessionId(): Promise<string | undefined> {
  return (await cookies()).get(productSessionCookie)?.value;
}

export async function writeProductSessionId(sessionId: string): Promise<void> {
  (await cookies()).set(productSessionCookie, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}
