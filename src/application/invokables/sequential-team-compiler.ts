import type { InvokableRepository } from '../ports/invokable-repository.js';
import {
  createCompiledSequentialTeamPlan,
  type CompiledSequentialTeamPlan,
} from '../../domain/invokables/compiled-team-plan.js';
import type {
  SequentialTeamGraph,
  SequentialTeamNode,
} from '../../domain/invokables/team-graph.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';

export class SequentialTeamCompiler {
  public constructor(
    private readonly invokables: Pick<
      InvokableRepository,
      'findPublishedAgentVersionById'
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async compile(
    teamVersion: TeamVersion,
  ): Promise<CompiledSequentialTeamPlan> {
    const graph = teamVersion.graph as SequentialTeamGraph;

    if (graph.nodes.length < 1) {
      throw new InvalidTeamGraphError(
        'Sequential teams require at least one node',
      );
    }

    const nodeById = new Map<string, SequentialTeamNode>();
    const incomingEdgeCounts = new Map<string, number>();
    const finalNodes: SequentialTeamNode[] = [];

    for (const node of graph.nodes) {
      if (nodeById.has(node.id)) {
        throw new InvalidTeamGraphError(`Duplicate team node id ${node.id}`);
      }

      nodeById.set(node.id, node);
      incomingEdgeCounts.set(node.id, 0);
      if (node.output === 'final') {
        finalNodes.push(node);
      }
    }

    for (const node of graph.nodes) {
      if (!node.successNodeId) {
        continue;
      }

      const target = nodeById.get(node.successNodeId);
      if (!target) {
        throw new InvalidTeamGraphError(
          `Node ${node.id} references unknown successor ${node.successNodeId}`,
        );
      }

      const nextIncomingCount = (incomingEdgeCounts.get(target.id) ?? 0) + 1;
      incomingEdgeCounts.set(target.id, nextIncomingCount);
      if (nextIncomingCount > 1) {
        throw new InvalidTeamGraphError(
          `Sequential teams cannot fan in to node ${target.id}`,
        );
      }
    }

    const entryNodes = graph.nodes.filter(
      (node) => (incomingEdgeCounts.get(node.id) ?? 0) === 0,
    );
    if (entryNodes.length !== 1) {
      throw new InvalidTeamGraphError(
        `Sequential teams require exactly one entry node, received ${entryNodes.length}`,
      );
    }
    if (finalNodes.length !== 1) {
      throw new InvalidTeamGraphError(
        `Sequential teams require exactly one final-output node, received ${finalNodes.length}`,
      );
    }

    const seen = new Set<string>();
    const compiledSteps: CompiledSequentialTeamPlan['steps'][number][] = [];
    let currentNode: SequentialTeamNode | null = entryNodes[0] ?? null;

    while (currentNode) {
      if (seen.has(currentNode.id)) {
        throw new InvalidTeamGraphError(
          `Sequential teams cannot contain loops; node ${currentNode.id} repeats`,
        );
      }

      seen.add(currentNode.id);

      const referencedAgent =
        await this.invokables.findPublishedAgentVersionById(
          currentNode.agentVersionId,
          {
            tenantId: teamVersion.tenantId,
            workspaceId: teamVersion.workspaceId,
            principalType: teamVersion.principalType,
            principalId: teamVersion.principalId,
          },
        );
      if (!referencedAgent) {
        throw new InvalidTeamGraphError(
          `Team node ${currentNode.id} must reference a published agent version in the same owner scope`,
        );
      }

      const order = compiledSteps.length + 1;
      compiledSteps.push({
        nodeId: currentNode.id,
        nodePath: `step.${String(order).padStart(4, '0')}`,
        agentVersionId: currentNode.agentVersionId,
        order,
        output: currentNode.output,
      });

      if (currentNode.output === 'final') {
        if (currentNode.successNodeId !== null) {
          throw new InvalidTeamGraphError(
            `Final-output node ${currentNode.id} cannot have a successor`,
          );
        }
        currentNode = null;
        continue;
      }

      if (!currentNode.successNodeId) {
        throw new InvalidTeamGraphError(
          `Non-final node ${currentNode.id} must have a success successor`,
        );
      }

      currentNode = nodeById.get(currentNode.successNodeId) ?? null;
    }

    if (seen.size !== graph.nodes.length) {
      throw new InvalidTeamGraphError(
        'Sequential teams cannot contain disconnected nodes or multiple chains',
      );
    }

    const finalNode = finalNodes[0];
    if (!finalNode) {
      throw new InvalidTeamGraphError(
        'Sequential teams require a final-output node',
      );
    }

    return createCompiledSequentialTeamPlan({
      teamVersionId: teamVersion.id,
      entryNodeId: entryNodes[0]!.id,
      finalOutputNodeId: finalNode.id,
      compiledAt: this.now().toISOString(),
      steps: compiledSteps,
    });
  }
}

export class InvalidTeamGraphError extends Error {
  public readonly code = 'invalid_team_graph';

  public constructor(message: string) {
    super(message);
    this.name = 'InvalidTeamGraphError';
  }
}
