import { createHash } from 'node:crypto';

import type { AccessContext } from '../../domain/access-context.js';
import type { WorkerRegistry } from '../ports/worker-registry.js';
import { assertWorkerKey, workerOwnerFromContext } from './import-worker.js';

export interface PublishWorkerVersionInput {
  readonly accessContext: AccessContext;
  readonly idempotencyKey: string;
  readonly versionId: string;
}

export async function publishWorkerVersion(
  registry: WorkerRegistry,
  input: PublishWorkerVersionInput,
) {
  assertWorkerKey(input.idempotencyKey);
  return registry.publishWorkerVersion({
    owner: workerOwnerFromContext(input.accessContext),
    idempotencyKey: input.idempotencyKey,
    versionId: input.versionId,
    requestFingerprint: `sha256:${createHash('sha256').update(input.versionId).digest('hex')}`,
  });
}
