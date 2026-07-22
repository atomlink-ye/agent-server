import { randomUUID } from 'node:crypto';

import {
  assertCreatedAndUpdatedAt,
  assertInvokableOwnerScope,
  assertNonEmptyString,
  normalizeOptionalText,
  type InvokableOwnerScope,
} from './invokable.js';

export interface TeamDefinition extends InvokableOwnerScope {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TeamDefinitionSnapshot = TeamDefinition;

export interface CreateTeamDefinitionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly name: string;
  readonly description?: string | null;
  readonly now?: () => Date;
}

export function createTeamDefinition(
  options: CreateTeamDefinitionOptions,
): TeamDefinition {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();

  return rehydrateTeamDefinition({
    id: options.id ?? randomUUID(),
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    name: options.name,
    description: normalizeOptionalText(options.description),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function rehydrateTeamDefinition(
  snapshot: TeamDefinitionSnapshot,
): TeamDefinition {
  assertNonEmptyString('id', snapshot.id, 'Team definition');
  assertInvokableOwnerScope(snapshot, 'Team definition');
  assertNonEmptyString('name', snapshot.name, 'Team definition');
  assertCreatedAndUpdatedAt(
    snapshot.createdAt,
    snapshot.updatedAt,
    'Team definition',
  );

  return Object.freeze({
    ...snapshot,
    description: normalizeOptionalText(snapshot.description),
  });
}
