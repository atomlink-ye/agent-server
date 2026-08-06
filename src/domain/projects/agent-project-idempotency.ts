import { createHash } from 'node:crypto';

export function deterministicIdempotencyKey(
  operation: string,
  projectName: string,
  logicalRef: string,
  fingerprint: string,
): string {
  const value = `${operation}|${projectName}|${logicalRef}|${fingerprint}`;
  return `agent-project-${createHash('sha256').update(value).digest('hex')}`.slice(
    0,
    96,
  );
}
