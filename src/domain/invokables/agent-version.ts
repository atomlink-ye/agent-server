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

export interface AgentVersion extends InvokableOwnerScope {
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

export type AgentVersionSnapshot = AgentVersion;

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

export function createDraftAgentVersion(
  options: CreateDraftAgentVersionOptions,
): AgentVersion {
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

export function reviseDraftAgentVersion(
  version: AgentVersion,
  patch: ReviseDraftAgentVersionPatch,
  now: () => Date = () => new Date(),
): AgentVersion {
  assertDraft(version, 'Agent version');

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

export function publishAgentVersion(
  version: AgentVersion,
  now: () => Date = () => new Date(),
): AgentVersion {
  assertDraft(version, 'Agent version');

  const publishedAt = now().toISOString();
  return rehydrateAgentVersion({
    ...version,
    status: 'published',
    updatedAt: publishedAt,
    publishedAt,
  });
}

export function rehydrateAgentVersion(
  snapshot: AgentVersionSnapshot,
): AgentVersion {
  assertNonEmptyString('id', snapshot.id, 'Agent version');
  assertNonEmptyString('definitionId', snapshot.definitionId, 'Agent version');
  assertInvokableOwnerScope(snapshot, 'Agent version');
  assertNonEmptyString('name', snapshot.name, 'Agent version');
  assertNonEmptyString('instructions', snapshot.instructions, 'Agent version');
  assertCreatedAndUpdatedAt(
    snapshot.createdAt,
    snapshot.updatedAt,
    'Agent version',
  );

  if (snapshot.status === 'draft') {
    if (snapshot.publishedAt !== null) {
      throw new Error('Draft agent versions cannot have publishedAt set');
    }
  } else if (snapshot.status === 'published') {
    if (snapshot.publishedAt === null) {
      throw new Error('Published agent versions require publishedAt');
    }
    assertIsoInstant('publishedAt', snapshot.publishedAt, 'Agent version');
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
  version: AgentVersion,
  label: string,
): asserts version is AgentVersion & { readonly status: 'draft' } {
  if (version.status !== 'draft') {
    throw new Error(`${label} is already published and immutable`);
  }
}
