import { createHash } from 'node:crypto';

/** Hashes an authorization bearer for durable lookup; plaintext never crosses the adapter boundary. */
export function hashBearerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
