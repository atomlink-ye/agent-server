import { randomUUID } from 'node:crypto';

import type { AgentDefinition as CanonicalAgentDefinition } from '../agents/managed-agent-definition.js';
import { normalizeManagedAgentName } from '../agents/managed-agent-owner.js';
import {
  assertCreatedAndUpdatedAt,
  assertInvokableOwnerScope,
  assertNonEmptyString,
  normalizeOptionalText,
  type InvokableOwnerScope,
} from './invokable.js';

type CanonicalDisplayFields = Pick<
  CanonicalAgentDefinition,
  'normalizedName' | 'displayName' | 'roleLabel' | 'summary'
>;

/**
 * Read-only compatibility projection for historical invokable fixtures.
 *
 * The managed/coworker AgentDefinition in ../agents/managed-agent-definition.ts
 * is the only strict product Agent identity. This shape exists only so old
 * snapshots/tests can be decoded while callers migrate away from the invokable
 * Agent surface. Production code must not use it as an Agent aggregate.
 */
export type LegacyAgentDefinitionProjection = Readonly<
  Omit<CanonicalAgentDefinition, keyof CanonicalDisplayFields> &
    Partial<CanonicalDisplayFields> & {
      readonly name: string;
      readonly description: string | null;
    }
>;

export type LegacyAgentDefinitionSnapshot = LegacyAgentDefinitionProjection;

export interface CreateLegacyAgentDefinitionProjectionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly name: string;
  readonly description?: string | null;
  readonly now?: () => Date;
}

/** @deprecated Test/legacy fixture helper. New Agent creation must use importAgent(). */
export function createAgentDefinition(
  options: CreateLegacyAgentDefinitionProjectionOptions,
): LegacyAgentDefinitionProjection {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const description = normalizeOptionalText(options.description);

  return rehydrateLegacyAgentDefinitionProjection({
    id: options.id ?? randomUUID(),
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    normalizedName: normalizeManagedAgentName(options.name),
    displayName: options.name,
    roleLabel: null,
    summary: description,
    name: options.name,
    description,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

/** @deprecated Compatibility decoder only. */
export function rehydrateAgentDefinition(
  snapshot: LegacyAgentDefinitionSnapshot,
): LegacyAgentDefinitionProjection {
  return rehydrateLegacyAgentDefinitionProjection(snapshot);
}

export function rehydrateLegacyAgentDefinitionProjection(
  snapshot: LegacyAgentDefinitionSnapshot,
): LegacyAgentDefinitionProjection {
  assertNonEmptyString('id', snapshot.id, 'Legacy agent definition projection');
  assertInvokableOwnerScope(snapshot, 'Legacy agent definition projection');
  assertNonEmptyString(
    'name',
    snapshot.name,
    'Legacy agent definition projection',
  );
  assertCreatedAndUpdatedAt(
    snapshot.createdAt,
    snapshot.updatedAt,
    'Legacy agent definition projection',
  );

  const description = normalizeOptionalText(snapshot.description);
  const displayName = snapshot.displayName ?? snapshot.name;
  const normalizedName =
    snapshot.normalizedName || normalizeManagedAgentName(displayName);
  if (!normalizedName)
    throw new Error('Agent definition name could not be normalized.');

  return Object.freeze({
    ...snapshot,
    normalizedName,
    displayName,
    roleLabel: snapshot.roleLabel ?? null,
    summary: snapshot.summary ?? description,
    name: displayName,
    description,
  });
}
