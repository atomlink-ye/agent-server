import { createHash } from 'node:crypto';

import type { AccessContext } from '../../domain/access-context.js';
import { createWorkerDefinition } from '../../domain/workers/worker-definition.js';
import { createWorkerDraft } from '../../domain/workers/worker-version.js';
import type { WorkerOwner } from '../../domain/workers/worker-owner.js';
import type { WorkerRegistry } from '../ports/worker-registry.js';
import { InvalidIdempotencyKeyError } from '../agents/errors.js';
import { parseWorkerForImport } from './validate-worker-package.js';

export interface ImportWorkerInput {
  readonly accessContext: AccessContext;
  readonly idempotencyKey: string;
  readonly source: string;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export async function importWorker(
  registry: WorkerRegistry,
  input: ImportWorkerInput,
) {
  assertWorkerKey(input.idempotencyKey);
  const parsed = parseWorkerForImport(input.source);
  const owner = workerOwnerFromContext(input.accessContext);
  const definition = createWorkerDefinition({
    ...owner,
    normalizedName: parsed.normalizedName,
    displayName: parsed.package.metadata.name,
    description: parsed.package.spec.description || null,
    ...(input.idFactory ? { id: input.idFactory() } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  const version = createWorkerDraft({
    definition,
    parsed,
    ...(input.idFactory ? { id: input.idFactory() } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  return registry.importWorker({
    owner,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: `sha256:${createHash('sha256').update(input.source).digest('hex')}`,
    normalizedName: parsed.normalizedName,
    definition,
    version,
  });
}

export function workerOwnerFromContext(context: AccessContext): WorkerOwner {
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    principalType: context.principalType,
    principalId: context.principalId,
  };
}

export function assertWorkerKey(key: string): void {
  if (typeof key !== 'string' || !key.trim() || key.length > 255)
    throw new InvalidIdempotencyKeyError();
}
