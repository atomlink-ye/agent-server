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

export interface TeamSpec {
  readonly lead: { readonly name: string; readonly agentVersionId: string };
  readonly roster: readonly {
    readonly name: string;
    readonly agentVersionId: string;
  }[];
  readonly environmentVersionId: string;
}

export interface TeamVersion extends InvokableOwnerScope {
  readonly id: string;
  readonly definitionId: string;
  readonly status: InvokableVersionStatus;
  readonly name: string;
  readonly description: string | null;
  readonly spec: TeamSpec;
  readonly environmentVersionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface CreateDraftTeamVersionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly definitionId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly spec: TeamSpec;
  readonly now?: () => Date;
}

export function createDraftTeamVersion(
  options: CreateDraftTeamVersionOptions,
): TeamVersion {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  return rehydrateTeamVersion({
    id: options.id ?? randomUUID(),
    definitionId: options.definitionId,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    status: 'draft',
    name: options.name,
    description: normalizeOptionalText(options.description),
    spec: options.spec,
    environmentVersionId: options.spec.environmentVersionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: null,
  });
}

export function publishTeamVersion(
  version: TeamVersion,
  now: () => Date = () => new Date(),
): TeamVersion {
  if (version.status !== 'draft')
    throw new Error('Team version is already published and immutable');
  const publishedAt = now().toISOString();
  return rehydrateTeamVersion({
    ...version,
    status: 'published',
    updatedAt: publishedAt,
    publishedAt,
  });
}

export function rehydrateTeamVersion(snapshot: TeamVersion): TeamVersion {
  assertNonEmptyString('id', snapshot.id, 'Team version');
  assertNonEmptyString('definitionId', snapshot.definitionId, 'Team version');
  assertInvokableOwnerScope(snapshot, 'Team version');
  assertNonEmptyString('name', snapshot.name, 'Team version');
  assertCreatedAndUpdatedAt(
    snapshot.createdAt,
    snapshot.updatedAt,
    'Team version',
  );
  assertNonEmptyString(
    'environmentVersionId',
    snapshot.spec.environmentVersionId,
    'Team version',
  );
  assertNonEmptyString('lead.name', snapshot.spec.lead.name, 'Team version');
  if (snapshot.spec.lead.name !== snapshot.spec.lead.name.trim())
    throw new Error(
      'Team version member names cannot contain outer whitespace',
    );
  assertNonEmptyString(
    'lead.agentVersionId',
    snapshot.spec.lead.agentVersionId,
    'Team version',
  );
  if (snapshot.spec.roster.length < 1)
    throw new Error('Team version roster must contain at least one member');
  const memberNames = new Set([snapshot.spec.lead.name]);
  for (const [index, member] of snapshot.spec.roster.entries()) {
    assertNonEmptyString(`roster[${index}].name`, member.name, 'Team version');
    assertNonEmptyString(
      `roster[${index}].agentVersionId`,
      member.agentVersionId,
      'Team version',
    );
    if (member.name !== member.name.trim())
      throw new Error(
        'Team version member names cannot contain outer whitespace',
      );
    if (memberNames.has(member.name))
      throw new Error('Team version member names must be unique');
    memberNames.add(member.name);
  }
  if (snapshot.environmentVersionId !== snapshot.spec.environmentVersionId)
    throw new Error('Team version environment pin must match its spec');
  if (snapshot.status === 'draft' && snapshot.publishedAt !== null)
    throw new Error('Draft team versions cannot have publishedAt set');
  if (snapshot.status === 'published') {
    if (snapshot.publishedAt === null)
      throw new Error('Published team versions require publishedAt');
    assertIsoInstant('publishedAt', snapshot.publishedAt, 'Team version');
  }
  return Object.freeze({
    ...snapshot,
    description: normalizeOptionalText(snapshot.description),
    spec: Object.freeze({
      ...snapshot.spec,
      lead: Object.freeze({ ...snapshot.spec.lead }),
      roster: Object.freeze(
        snapshot.spec.roster.map((member) => Object.freeze({ ...member })),
      ),
    }),
  });
}
