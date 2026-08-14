import { createHash, randomUUID } from 'node:crypto';
import type { AccessContext } from '../../platform/access-context.js';
import type { EnvironmentRegistry } from '../ports/environment-registry.js';
import {
  parseManagedEnvironmentPackage,
  ManagedEnvironmentPackageError,
} from '../../domain/environments/managed-environment-package.js';
import { normalizeManagedAgentName } from '../../domain/agents/managed-agent-owner.js';
export class EnvironmentPackageValidationError extends Error {
  constructor(readonly code: string = 'invalid_package') {
    super(code);
  }
}
export const validateEnvironmentPackage = (source: string) => {
  try {
    return parseManagedEnvironmentPackage(source);
  } catch (e) {
    if (e instanceof ManagedEnvironmentPackageError)
      throw new EnvironmentPackageValidationError(e.code);
    throw e;
  }
};
const owner = (c: AccessContext) => ({
  tenantId: c.tenantId,
  principalType: c.principalType,
  principalId: c.principalId,
});
const hash = (s: string) =>
  `sha256:${createHash('sha256').update(s).digest('hex')}`;
export async function importEnvironment(
  registry: EnvironmentRegistry,
  input: {
    accessContext: AccessContext;
    idempotencyKey: string;
    source: string;
  },
) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 255)
    throw new EnvironmentPackageValidationError('invalid_idempotency_key');
  const p = validateEnvironmentPackage(input.source),
    o = owner(input.accessContext),
    at = new Date().toISOString(),
    definition = {
      ...o,
      id: randomUUID(),
      normalizedName: p.normalizedName,
      displayName: p.package.metadata.name,
      createdAt: at,
      updatedAt: at,
    },
    version = {
      ...o,
      id: randomUUID(),
      definitionId: definition.id,
      status: 'draft' as const,
      displayName: p.package.metadata.name,
      package: p.package,
      canonicalJson: p.canonicalJson,
      fingerprint: p.fingerprint,
      createdAt: at,
      updatedAt: at,
      publishedAt: null,
    };
  return registry.importEnvironment({
    owner: o,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: hash(input.source),
    definition,
    version,
  });
}
export async function publishEnvironmentVersion(
  registry: EnvironmentRegistry,
  input: {
    accessContext: AccessContext;
    idempotencyKey: string;
    versionId: string;
  },
) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 255)
    throw new EnvironmentPackageValidationError('invalid_idempotency_key');
  return registry.publishEnvironmentVersion({
    owner: owner(input.accessContext),
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: hash(input.versionId),
    versionId: input.versionId,
  });
}
