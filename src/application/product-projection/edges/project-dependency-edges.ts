import type { WorkProjectionDependencyFact } from '../../work/work-projection-facts.js';
import type { ProductDeclaredDependencyEdge } from '../../../contracts/product-projection/edges.js';
import { EdgeProjection, teamRunRefs } from './shared.js';

export function projectDependencyEdges(
  dependencies: readonly WorkProjectionDependencyFact[],
): EdgeProjection<ProductDeclaredDependencyEdge> {
  const edges = dependencies.map((raw) => {
    if (!raw.teamRunId)
      throw new Error('Dependency source refs must include team run ID.');
    return {
      kind: 'declared_dependency' as const,
      guarantee: 'declared_relation' as const,
      dependent_work_item_id: raw.sourceWorkItemId,
      prerequisite_work_item_id: raw.dependencyWorkItemId,
      source_created_at: raw.createdAt,
      source_refs: teamRunRefs(raw.teamRunId),
    } satisfies ProductDeclaredDependencyEdge;
  });
  return {
    edges,
    sourceRowKeys: edges.map(
      (edge) =>
        `${edge.source_refs.team_run_id}:${edge.dependent_work_item_id}:${edge.prerequisite_work_item_id}`,
    ),
  };
}

export const mapDeclaredDependencyEdges = projectDependencyEdges;
export const mapDeclaredDependency = projectDependencyEdges;
