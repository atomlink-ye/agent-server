import { randomUUID } from 'node:crypto';

import type { WorkerDefinition } from './worker-definition.js';
import type { ParsedWorkerPackage, WorkerPackage } from './worker-package.js';
import type { WorkerOwner } from './worker-owner.js';

export type WorkerVersionStatus = 'draft' | 'published';

export interface WorkerVersion extends WorkerOwner {
  readonly id: string;
  readonly definitionId: string;
  readonly status: WorkerVersionStatus;
  readonly displayName: string;
  readonly description: string | null;
  readonly package: WorkerPackage;
  readonly canonicalJson: string;
  readonly fingerprint: string;
  readonly compiler: ParsedWorkerPackage['compiler'];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export function createWorkerDraft(options: {
  readonly definition: WorkerDefinition;
  readonly parsed: ParsedWorkerPackage;
  readonly id?: string;
  readonly now?: () => Date;
}): WorkerVersion {
  const at = (options.now ?? (() => new Date()))().toISOString();
  return deepFreeze({
    id: options.id ?? randomUUID(),
    definitionId: options.definition.id,
    tenantId: options.definition.tenantId,
    workspaceId: options.definition.workspaceId,
    principalType: options.definition.principalType,
    principalId: options.definition.principalId,
    status: 'draft',
    displayName: options.parsed.package.metadata.name,
    description: options.parsed.package.spec.description || null,
    package: options.parsed.package,
    canonicalJson: options.parsed.canonicalJson,
    fingerprint: options.parsed.fingerprint,
    compiler: options.parsed.compiler,
    createdAt: at,
    updatedAt: at,
    publishedAt: null,
  });
}

export function publishWorkerVersion(
  version: WorkerVersion,
  now = () => new Date(),
): WorkerVersion {
  if (version.status === 'published') return version;
  const at = now().toISOString();
  return deepFreeze({
    ...version,
    status: 'published',
    updatedAt: at,
    publishedAt: at,
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
