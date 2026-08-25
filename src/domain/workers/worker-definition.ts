import { randomUUID } from 'node:crypto';

import type { WorkerOwner } from './worker-owner.js';

export interface WorkerDefinition extends WorkerOwner {
  readonly id: string;
  readonly normalizedName: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createWorkerDefinition(
  options: Omit<
    WorkerDefinition,
    'id' | 'createdAt' | 'updatedAt' | 'description'
  > & {
    readonly id?: string;
    readonly now?: () => Date;
    readonly description?: string | null;
  },
): WorkerDefinition {
  const { id, now, description, ...durable } = options;
  const at = (now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    ...durable,
    id: id ?? randomUUID(),
    description: description ?? null,
    createdAt: at,
    updatedAt: at,
  });
}
