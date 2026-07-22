import { randomUUID } from 'node:crypto';

import {
  assertCreatedAndUpdatedAt,
  assertInvokableOwnerScope,
  assertNonEmptyString,
  normalizeOptionalText,
  type InvokableOwnerScope,
} from './invokable.js';

export interface AgentDefinition extends InvokableOwnerScope {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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

  return rehydrateAgentDefinition({
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

  return Object.freeze({
    ...snapshot,
    description: normalizeOptionalText(snapshot.description),
  });
}
