import { assertNonEmptyString } from './invokable.js';

export const teamNodeOutputs = ['step', 'final'] as const;

export type TeamNodeOutput = (typeof teamNodeOutputs)[number];

export interface SequentialTeamNode {
  readonly id: string;
  readonly kind: 'invoke';
  readonly agentVersionId: string;
  readonly successNodeId: string | null;
  readonly output: TeamNodeOutput;
}

export interface SequentialTeamGraph {
  readonly nodes: readonly SequentialTeamNode[];
}

export function cloneSequentialTeamGraph(
  graph: SequentialTeamGraph,
): SequentialTeamGraph {
  assertSequentialTeamGraphShape(graph);

  return Object.freeze({
    nodes: Object.freeze(
      graph.nodes.map((node) =>
        Object.freeze({
          id: node.id,
          kind: node.kind,
          agentVersionId: node.agentVersionId,
          successNodeId: node.successNodeId,
          output: node.output,
        }),
      ),
    ),
  });
}

export function assertSequentialTeamGraphShape(
  graph: SequentialTeamGraph,
): void {
  for (const node of graph.nodes) {
    assertNonEmptyString('node.id', node.id, 'Team graph');
    if (node.kind !== 'invoke') {
      throw new Error(
        'Team graph supports only invoke nodes in the sequential MVP',
      );
    }
    assertNonEmptyString(
      'node.agentVersionId',
      node.agentVersionId,
      'Team graph',
    );
    if (node.successNodeId !== null) {
      assertNonEmptyString(
        'node.successNodeId',
        node.successNodeId,
        'Team graph',
      );
    }
    if (!teamNodeOutputs.includes(node.output)) {
      throw new Error(`Unsupported team node output ${String(node.output)}`);
    }
  }
}
