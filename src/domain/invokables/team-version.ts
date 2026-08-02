import { randomUUID } from 'node:crypto';

import {
  rehydrateCompiledDagTeamPlan,
  rehydrateCompiledSequentialTeamPlan,
  type CompiledTeamPlan,
} from './compiled-team-plan.js';
import {
  cloneSequentialTeamGraph,
  cloneDagTeamGraph,
  type TeamGraph,
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

export type TeamExecutionMode = 'legacy_graph' | 'collaborative_mve' | 'agentic_mve';

export interface TeamCollaborationSpec {
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
  readonly executionMode: TeamExecutionMode;
  readonly graph: TeamGraph | null;
  readonly environmentVersionId: string | null;
  readonly collaborationSpec: TeamCollaborationSpec | null;
  readonly compiledPlan: CompiledTeamPlan | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export type TeamVersionSnapshot = TeamVersion & {
  readonly executionMode?: TeamExecutionMode;
  readonly collaborationSpec?: TeamCollaborationSpec | null;
};

export interface CreateDraftTeamVersionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly definitionId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly graph: TeamGraph;
  readonly environmentVersionId?: string | null;
  readonly now?: () => Date;
}

export interface CreateCollaborativeDraftTeamVersionOptions extends InvokableOwnerScope {
  readonly id?: string;
  readonly definitionId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly collaborationSpec: TeamCollaborationSpec;
  readonly now?: () => Date;
  readonly executionMode?: 'collaborative_mve' | 'agentic_mve';
}

export interface ReviseDraftTeamVersionPatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly graph?: TeamGraph;
  readonly environmentVersionId?: string | null;
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
    executionMode: 'legacy_graph',
    graph: options.graph,
    collaborationSpec: null,
    environmentVersionId: options.environmentVersionId ?? null,
    compiledPlan: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: null,
  });
}

export function createCollaborativeDraftTeamVersion(
  options: CreateCollaborativeDraftTeamVersionOptions,
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
    executionMode: options.executionMode ?? 'collaborative_mve',
    graph: null,
    collaborationSpec: options.collaborationSpec,
    environmentVersionId: options.collaborationSpec.environmentVersionId,
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
    ...(patch.environmentVersionId !== undefined
      ? { environmentVersionId: patch.environmentVersionId }
      : {}),
    updatedAt: now().toISOString(),
  });
}

export function publishTeamVersion(
  version: TeamVersion,
  compiledPlan: CompiledTeamPlan,
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

export function publishCollaborativeTeamVersion(
  version: TeamVersion,
  now: () => Date = () => new Date(),
): TeamVersion {
  assertDraft(version, 'Team version');
  if (version.executionMode !== 'collaborative_mve' && version.executionMode !== 'agentic_mve') {
    throw new Error(
      'Only collaborative team versions can be published without a compiled plan',
    );
  }

  const publishedAt = now().toISOString();
  return rehydrateTeamVersion({
    ...version,
    status: 'published',
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

  const executionMode: TeamExecutionMode =
    snapshot.executionMode ?? 'legacy_graph';
  const collaborationSpec: TeamCollaborationSpec | null =
    executionMode === 'collaborative_mve' || executionMode === 'agentic_mve'
      ? (snapshot.collaborationSpec ?? null)
      : null;

  if ((executionMode === 'collaborative_mve' || executionMode === 'agentic_mve') && !collaborationSpec) {
    throw new Error('Collaborative team versions require collaborationSpec');
  }

  const compiledPlan = snapshot.compiledPlan
    ? snapshot.compiledPlan.compilerVersion === 'dag-mve-v1'
      ? rehydrateCompiledDagTeamPlan(snapshot.compiledPlan)
      : rehydrateCompiledSequentialTeamPlan(snapshot.compiledPlan)
    : null;

  if (snapshot.status === 'draft') {
    if (snapshot.publishedAt !== null) {
      throw new Error('Draft team versions cannot have publishedAt set');
    }
    if (executionMode !== 'collaborative_mve' && executionMode !== 'agentic_mve' && compiledPlan !== null) {
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
    if (executionMode === 'collaborative_mve' || executionMode === 'agentic_mve') {
      if (!collaborationSpec) {
        throw new Error(
          'Published collaborative team versions require collaborationSpec',
        );
      }
    } else {
      if (compiledPlan === null) {
        throw new Error('Published team versions require a compiled plan');
      }
      if (compiledPlan.teamVersionId !== snapshot.id) {
        throw new Error(
          'Compiled team plan must belong to the published team version',
        );
      }
      if (compiledPlan.compilerVersion === 'dag-mve-v1') {
        if (
          !snapshot.environmentVersionId ||
          compiledPlan.environmentVersionId !== snapshot.environmentVersionId
        ) {
          throw new Error(
            'DAG compiled plan must use the Team EnvironmentVersion pin',
          );
        }
      }
    }
  } else {
    throw new Error(
      `Unsupported team version status ${String(snapshot.status)}`,
    );
  }

  const graph: TeamGraph | null =
    executionMode === 'collaborative_mve' || executionMode === 'agentic_mve'
      ? null
      : snapshot.graph
        ? 'mode' in snapshot.graph &&
          (snapshot.graph as { mode?: string }).mode === 'dag-mve-v1'
          ? cloneDagTeamGraph(snapshot.graph)
          : cloneSequentialTeamGraph(snapshot.graph as SequentialTeamGraph)
        : null;

  return Object.freeze({
    ...snapshot,
    executionMode,
    description: normalizeOptionalText(snapshot.description),
    graph,
    collaborationSpec,
    environmentVersionId: snapshot.environmentVersionId ?? null,
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
