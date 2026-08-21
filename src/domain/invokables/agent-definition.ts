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
 * Compatibility view for the old invokable API.
 *
 * The managed/coworker AgentDefinition is the sole strict product identity.
 * Legacy callers still use name/description and may not yet project the newer
 * display fields, so those canonical aliases stay optional only on this adapter.
 */
export type AgentDefinition = Readonly<
  Omit<CanonicalAgentDefinition, keyof CanonicalDisplayFields> &
    Partial<CanonicalDisplayFields> & {
      readonly name: string;
      readonly description: string | null;
    }
>;

export type AgentDefinitionSnapshot = AgentDefinition;

export interface CreateAgentDefinitionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly name: string;
  readonly description?: string | null;
  readonly now?: () => Date;
}

export function createAgentDefinition(
  options: CreateAgentDefinitionOptions,
): AgentDefinition {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const description = normalizeOptionalText(options.description);

  return rehydrateAgentDefinition({
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

export function rehydrateAgentDefinition(
  snapshot: AgentDefinitionSnapshot,
): AgentDefinition {
  assertNonEmptyString('id', snapshot.id, 'Agent definition');
  assertInvokableOwnerScope(snapshot, 'Agent definition');
  assertNonEmptyString('name', snapshot.name, 'Agent definition');
  assertCreatedAndUpdatedAt(
    snapshot.createdAt,
    snapshot.updatedAt,
    'Agent definition',
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
