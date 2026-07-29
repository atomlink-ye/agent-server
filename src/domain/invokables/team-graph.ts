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

export const DAG_TEAM_GRAPH_MODE = 'dag-mve-v1' as const;

export interface DagTeamNode {
  readonly id: string;
  readonly kind: 'invoke';
  readonly agentVersionId: string;
  readonly dependsOn: readonly string[];
  readonly output: TeamNodeOutput;
}

export interface DagTeamGraph {
  readonly mode: typeof DAG_TEAM_GRAPH_MODE;
  readonly nodes: readonly DagTeamNode[];
}

export type TeamGraph = SequentialTeamGraph | DagTeamGraph;

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

export function cloneDagTeamGraph(graph: DagTeamGraph): DagTeamGraph {
  assertDagTeamGraphShape(graph);
  return Object.freeze({
    mode: graph.mode,
    nodes: Object.freeze(
      graph.nodes.map((node) =>
        Object.freeze({
          ...node,
          dependsOn: Object.freeze([...node.dependsOn]),
        }),
      ),
    ),
  });
}

export function assertDagTeamGraphShape(graph: DagTeamGraph): void {
  if (graph.mode !== DAG_TEAM_GRAPH_MODE) {
    throw new Error(`Unsupported team graph mode ${String(graph.mode)}`);
  }
  for (const node of graph.nodes) {
    assertNonEmptyString('node.id', node.id, 'DAG team graph');
    if (node.kind !== 'invoke')
      throw new Error('DAG teams support only invoke nodes');
    assertNonEmptyString(
      'node.agentVersionId',
      node.agentVersionId,
      'DAG team graph',
    );
    if (!Array.isArray(node.dependsOn))
      throw new Error('DAG node dependsOn must be an array');
    for (const dependency of node.dependsOn) {
      assertNonEmptyString('node.dependsOn', dependency, 'DAG team graph');
    }
    if (!teamNodeOutputs.includes(node.output)) {
      throw new Error(`Unsupported team node output ${String(node.output)}`);
    }
  }
}
