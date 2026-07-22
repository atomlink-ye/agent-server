import { randomUUID } from 'node:crypto';

import {
  rehydrateCompiledSequentialTeamPlan,
  type CompiledSequentialTeamPlan,
} from './compiled-team-plan.js';
import {
  cloneSequentialTeamGraph,
  type SequentialTeamGraph,
} from './team-graph.js';
import {
  assertCreatedAndUpdatedAt,
  assertInvokableOwnerScope,
  assertIsoInstant,
  assertNonEmptyString,
  normalizeOptionalText,
  type InvokableOwnerScope,
  type InvokableVersionStatus,
} from './invokable.js';

export interface TeamVersion extends InvokableOwnerScope {
  readonly id: string;
  readonly definitionId: string;
  readonly status: InvokableVersionStatus;
  readonly name: string;
  readonly description: string | null;
  readonly graph: SequentialTeamGraph;
  readonly compiledPlan: CompiledSequentialTeamPlan | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export type TeamVersionSnapshot = TeamVersion;

export interface CreateDraftTeamVersionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly definitionId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly graph: SequentialTeamGraph;
  readonly now?: () => Date;
}

export interface ReviseDraftTeamVersionPatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly graph?: SequentialTeamGraph;
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
    graph: options.graph,
    compiledPlan: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: null,
  });
}

export function reviseDraftTeamVersion(
  version: TeamVersion,
  patch: ReviseDraftTeamVersionPatch,
  now: () => Date = () => new Date(),
): TeamVersion {
  assertDraft(version, 'Team version');

  return rehydrateTeamVersion({
    ...version,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined
      ? { description: normalizeOptionalText(patch.description) }
      : {}),
    ...(patch.graph !== undefined ? { graph: patch.graph } : {}),
    updatedAt: now().toISOString(),
  });
}

export function publishTeamVersion(
  version: TeamVersion,
  compiledPlan: CompiledSequentialTeamPlan,
  now: () => Date = () => new Date(),
): TeamVersion {
  assertDraft(version, 'Team version');

  const publishedAt = now().toISOString();
  return rehydrateTeamVersion({
    ...version,
    status: 'published',
    compiledPlan,
    updatedAt: publishedAt,
    publishedAt,
  });
}

export function rehydrateTeamVersion(
  snapshot: TeamVersionSnapshot,
): TeamVersion {
  assertNonEmptyString('id', snapshot.id, 'Team version');
  assertNonEmptyString('definitionId', snapshot.definitionId, 'Team version');
  assertInvokableOwnerScope(snapshot, 'Team version');
  assertNonEmptyString('name', snapshot.name, 'Team version');
  assertCreatedAndUpdatedAt(
    snapshot.createdAt,
    snapshot.updatedAt,
    'Team version',
  );

  const compiledPlan = snapshot.compiledPlan
    ? rehydrateCompiledSequentialTeamPlan(snapshot.compiledPlan)
    : null;

  if (snapshot.status === 'draft') {
    if (snapshot.publishedAt !== null) {
      throw new Error('Draft team versions cannot have publishedAt set');
    }
    if (compiledPlan !== null) {
      throw new Error('Draft team versions cannot have a compiled plan');
    }
  } else if (snapshot.status === 'published') {
    if (snapshot.publishedAt === null) {
      throw new Error('Published team versions require publishedAt');
    }
    assertIsoInstant('publishedAt', snapshot.publishedAt, 'Team version');
    if (Date.parse(snapshot.updatedAt) < Date.parse(snapshot.publishedAt)) {
      throw new Error(
        'Published team versions require updatedAt greater than or equal to publishedAt',
      );
    }
    if (compiledPlan === null) {
      throw new Error('Published team versions require a compiled plan');
    }
    if (compiledPlan.teamVersionId !== snapshot.id) {
      throw new Error(
        'Compiled team plan must belong to the published team version',
      );
    }
  } else {
    throw new Error(
      `Unsupported team version status ${String(snapshot.status)}`,
    );
  }

  return Object.freeze({
    ...snapshot,
    description: normalizeOptionalText(snapshot.description),
    graph: cloneSequentialTeamGraph(snapshot.graph),
    compiledPlan,
  });
}

function assertDraft(
  version: TeamVersion,
  label: string,
): asserts version is TeamVersion & { readonly status: 'draft' } {
  if (version.status !== 'draft') {
    throw new Error(`${label} is already published and immutable`);
  }
}
