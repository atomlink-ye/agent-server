import { randomUUID } from 'node:crypto';

import {
  assertCreatedAndUpdatedAt,
  assertInvokableOwnerScope,
  assertIsoInstant,
  assertNonEmptyString,
  normalizeOptionalText,
  type InvokableOwnerScope,
  type InvokableVersionStatus,
} from './invokable.js';

/**
 * Historical invokable Agent version projection.
 *
 * ManagedAgentVersion is the sole strict product/runtime Agent version. This
 * projection remains only for compatibility fixtures that predate the managed
 * Agent package. Production Agent resolution must not depend on it.
 */
export interface LegacyAgentVersionProjection extends InvokableOwnerScope {
  readonly id: string;
  readonly definitionId: string;
  readonly status: InvokableVersionStatus;
  readonly name: string;
  readonly description: string | null;
  readonly instructions: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

/** @deprecated Test/legacy source compatibility only. */
export type AgentVersion = LegacyAgentVersionProjection;
export type LegacyAgentVersionSnapshot = LegacyAgentVersionProjection;
export type AgentVersionSnapshot = LegacyAgentVersionSnapshot;

export interface CreateDraftAgentVersionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly definitionId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly instructions: string;
  readonly now?: () => Date;
}

export interface ReviseDraftAgentVersionPatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly instructions?: string;
}

/** @deprecated Legacy fixture helper. New Agent versions come from importAgent(). */
export function createDraftAgentVersion(
  options: CreateDraftAgentVersionOptions,
): LegacyAgentVersionProjection {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();

  return rehydrateAgentVersion({
    id: options.id ?? randomUUID(),
    definitionId: options.definitionId,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    status: 'draft',
    name: options.name,
    description: normalizeOptionalText(options.description),
    instructions: options.instructions,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: null,
  });
}

/** @deprecated Legacy fixture helper. */
export function reviseDraftAgentVersion(
  version: LegacyAgentVersionProjection,
  patch: ReviseDraftAgentVersionPatch,
  now: () => Date = () => new Date(),
): LegacyAgentVersionProjection {
  assertDraft(version, 'Legacy agent version projection');

  return rehydrateAgentVersion({
    ...version,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined
      ? { description: normalizeOptionalText(patch.description) }
      : {}),
    ...(patch.instructions !== undefined
      ? { instructions: patch.instructions }
      : {}),
    updatedAt: now().toISOString(),
  });
}

/** @deprecated Legacy fixture helper. */
export function publishAgentVersion(
  version: LegacyAgentVersionProjection,
  now: () => Date = () => new Date(),
): LegacyAgentVersionProjection {
  assertDraft(version, 'Legacy agent version projection');

  const publishedAt = now().toISOString();
  return rehydrateAgentVersion({
    ...version,
    status: 'published',
    updatedAt: publishedAt,
    publishedAt,
  });
}

/** @deprecated Compatibility decoder only. */
export function rehydrateAgentVersion(
  snapshot: LegacyAgentVersionSnapshot,
): LegacyAgentVersionProjection {
  assertNonEmptyString('id', snapshot.id, 'Legacy agent version projection');
  assertNonEmptyString(
    'definitionId',
    snapshot.definitionId,
    'Legacy agent version projection',
  );
  assertInvokableOwnerScope(snapshot, 'Legacy agent version projection');
  assertNonEmptyString('name', snapshot.name, 'Legacy agent version projection');
  assertNonEmptyString(
    'instructions',
    snapshot.instructions,
    'Legacy agent version projection',
  );
  assertCreatedAndUpdatedAt(
    snapshot.createdAt,
    snapshot.updatedAt,
    'Legacy agent version projection',
  );

  if (snapshot.status === 'draft') {
    if (snapshot.publishedAt !== null) {
      throw new Error('Draft agent versions cannot have publishedAt set');
    }
  } else if (snapshot.status === 'published') {
    if (snapshot.publishedAt === null) {
      throw new Error('Published agent versions require publishedAt');
    }
    assertIsoInstant('publishedAt', snapshot.publishedAt, 'Legacy agent version projection');
    if (Date.parse(snapshot.updatedAt) < Date.parse(snapshot.publishedAt)) {
      throw new Error(
        'Published agent versions require updatedAt greater than or equal to publishedAt',
      );
    }
  } else {
    throw new Error(
      `Unsupported agent version status ${String(snapshot.status)}`,
    );
  }

  return Object.freeze({
    ...snapshot,
    description: normalizeOptionalText(snapshot.description),
  });
}

function assertDraft(
  version: LegacyAgentVersionProjection,
  label: string,
): asserts version is LegacyAgentVersionProjection & { readonly status: 'draft' } {
  if (version.status !== 'draft') {
    throw new Error(`${label} is already published and immutable`);
  }
}
