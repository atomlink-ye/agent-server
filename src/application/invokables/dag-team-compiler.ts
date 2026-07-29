import type { EnvironmentRegistry } from '../ports/environment-registry.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import {
  createCompiledDagTeamPlan,
  type CompiledDagTeamPlan,
} from '../../domain/invokables/compiled-team-plan.js';
import type {
  DagTeamGraph,
  DagTeamNode,
} from '../../domain/invokables/team-graph.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';
import { InvalidTeamGraphError } from './sequential-team-compiler.js';

export class DagTeamCompiler {
  public constructor(
    private readonly invokables: Pick<
      InvokableRepository,
      'findPublishedAgentVersionById'
    >,
    private readonly environments: Pick<EnvironmentRegistry, 'findVersion'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async compile(teamVersion: TeamVersion): Promise<CompiledDagTeamPlan> {
    const graph = teamVersion.graph;
    if (!('mode' in graph) || graph.mode !== 'dag-mve-v1') {
      throw new InvalidTeamGraphError(
        'DAG compiler requires graph mode dag-mve-v1',
      );
    }
    const dag = graph as DagTeamGraph;
    if (dag.nodes.length === 0)
      throw new InvalidTeamGraphError('DAG teams require at least one node');
    if (!teamVersion.environmentVersionId)
      throw new InvalidTeamGraphError(
        'DAG teams require an EnvironmentVersion pin',
      );

    const nodeById = new Map<string, DagTeamNode>();
    const finalNodes: DagTeamNode[] = [];
    for (const node of dag.nodes) {
      if (nodeById.has(node.id))
        throw new InvalidTeamGraphError(`Duplicate team node id ${node.id}`);
      if (node.kind !== 'invoke')
        throw new InvalidTeamGraphError(
          `Unsupported node kind ${String(node.kind)}`,
        );
      nodeById.set(node.id, node);
      if (node.output === 'final') finalNodes.push(node);
    }
    if (finalNodes.length !== 1)
      throw new InvalidTeamGraphError(
        `DAG teams require exactly one final-output node, received ${finalNodes.length}`,
      );
    const finalNode = finalNodes[0]!;
    for (const node of dag.nodes) {
      const dependencies = new Set<string>();
      for (const dependencyId of node.dependsOn) {
        if (dependencyId === node.id)
          throw new InvalidTeamGraphError(
            `Node ${node.id} cannot depend on itself`,
          );
        if (!nodeById.has(dependencyId))
          throw new InvalidTeamGraphError(
            `Node ${node.id} references unknown dependency ${dependencyId}`,
          );
        if (dependencies.has(dependencyId))
          throw new InvalidTeamGraphError(
            `Node ${node.id} has duplicate dependency ${dependencyId}`,
          );
        dependencies.add(dependencyId);
      }
    }
    const reachable = new Set<string>();
    const visit = (id: string): void => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const dependency of nodeById.get(id)!.dependsOn) visit(dependency);
    };
    visit(finalNode.id);
    if (reachable.size !== dag.nodes.length)
      throw new InvalidTeamGraphError(
        'DAG contains nodes not reachable toward the final output',
      );

    const state = new Map<string, 0 | 1 | 2>();
    const topological: DagTeamNode[] = [];
    const walk = (node: DagTeamNode): void => {
      if (state.get(node.id) === 1)
        throw new InvalidTeamGraphError(
          `DAG contains a cycle at node ${node.id}`,
        );
      if (state.get(node.id) === 2) return;
      state.set(node.id, 1);
      for (const dependencyId of node.dependsOn)
        walk(nodeById.get(dependencyId)!);
      state.set(node.id, 2);
      topological.push(node);
    };
    for (const node of dag.nodes) walk(node);

    const environment = await this.environments.findVersion(
      teamVersion,
      teamVersion.environmentVersionId,
    );
    if (!environment || environment.status !== 'published')
      throw new InvalidTeamGraphError(
        'DAG EnvironmentVersion must be published in the same owner scope',
      );
    const compiledNodes = [] as CompiledDagTeamPlan['nodes'][number][];
    for (const node of topological) {
      const agent = await this.invokables.findPublishedAgentVersionById(
        node.agentVersionId,
        teamVersion,
      );
      if (!agent)
        throw new InvalidTeamGraphError(
          `Team node ${node.id} must reference a published agent version in the same owner scope`,
        );
      const order = compiledNodes.length + 1;
      compiledNodes.push({
        nodeId: node.id,
        nodePath: `node.${String(order).padStart(4, '0')}`,
        agentVersionId: agent.id,
        dependencyNodeIds: [...node.dependsOn],
        order,
        output: node.output,
      });
    }
    return createCompiledDagTeamPlan({
      teamVersionId: teamVersion.id,
      environmentVersionId: environment.id,
      finalOutputNodeId: finalNode.id,
      compiledAt: this.now().toISOString(),
      nodes: compiledNodes,
    });
  }
}
