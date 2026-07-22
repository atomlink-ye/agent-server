import { assertIsoInstant, assertNonEmptyString } from './invokable.js';
import { type TeamNodeOutput } from './team-graph.js';

export const SEQUENTIAL_TEAM_COMPILER_VERSION = 'sequential-mvp-v1';

export interface CompiledSequentialTeamStep {
  readonly nodeId: string;
  readonly nodePath: string;
  readonly agentVersionId: string;
  readonly order: number;
  readonly output: TeamNodeOutput;
}

export interface CompiledSequentialTeamPlan {
  readonly compilerVersion: typeof SEQUENTIAL_TEAM_COMPILER_VERSION;
  readonly teamVersionId: string;
  readonly entryNodeId: string;
  readonly finalOutputNodeId: string;
  readonly compiledAt: string;
  readonly steps: readonly CompiledSequentialTeamStep[];
}

export type CompiledSequentialTeamPlanSnapshot = CompiledSequentialTeamPlan;

export interface CreateCompiledSequentialTeamPlanOptions {
  readonly compilerVersion?: typeof SEQUENTIAL_TEAM_COMPILER_VERSION;
  readonly teamVersionId: string;
  readonly entryNodeId: string;
  readonly finalOutputNodeId: string;
  readonly compiledAt: string;
  readonly steps: readonly CompiledSequentialTeamStep[];
}

export function createCompiledSequentialTeamPlan(
  options: CreateCompiledSequentialTeamPlanOptions,
): CompiledSequentialTeamPlan {
  return rehydrateCompiledSequentialTeamPlan({
    compilerVersion:
      options.compilerVersion ?? SEQUENTIAL_TEAM_COMPILER_VERSION,
    teamVersionId: options.teamVersionId,
    entryNodeId: options.entryNodeId,
    finalOutputNodeId: options.finalOutputNodeId,
    compiledAt: options.compiledAt,
    steps: options.steps,
  });
}

export function rehydrateCompiledSequentialTeamPlan(
  snapshot: CompiledSequentialTeamPlanSnapshot,
): CompiledSequentialTeamPlan {
  if (snapshot.compilerVersion !== SEQUENTIAL_TEAM_COMPILER_VERSION) {
    throw new Error(
      `Unsupported sequential team compiler version ${snapshot.compilerVersion}`,
    );
  }

  assertNonEmptyString(
    'teamVersionId',
    snapshot.teamVersionId,
    'Compiled team plan',
  );
  assertNonEmptyString(
    'entryNodeId',
    snapshot.entryNodeId,
    'Compiled team plan',
  );
  assertNonEmptyString(
    'finalOutputNodeId',
    snapshot.finalOutputNodeId,
    'Compiled team plan',
  );
  assertIsoInstant('compiledAt', snapshot.compiledAt, 'Compiled team plan');

  if (snapshot.steps.length < 1) {
    throw new Error('Compiled team plan requires at least one step');
  }

  const seenOrders = new Set<number>();
  const seenNodeIds = new Set<string>();
  const steps = snapshot.steps.map((step) => {
    assertNonEmptyString('step.nodeId', step.nodeId, 'Compiled team plan');
    assertNonEmptyString('step.nodePath', step.nodePath, 'Compiled team plan');
    assertNonEmptyString(
      'step.agentVersionId',
      step.agentVersionId,
      'Compiled team plan',
    );
    if (!Number.isInteger(step.order) || step.order < 1) {
      throw new Error(
        'Compiled team plan step order must be a positive integer',
      );
    }
    if (seenOrders.has(step.order)) {
      throw new Error(
        `Compiled team plan step order ${step.order} must be unique`,
      );
    }
    if (seenNodeIds.has(step.nodeId)) {
      throw new Error(`Compiled team plan node ${step.nodeId} must be unique`);
    }

    seenOrders.add(step.order);
    seenNodeIds.add(step.nodeId);

    return Object.freeze({ ...step });
  });

  const finalStep = steps[steps.length - 1];
  if (!finalStep || finalStep.output !== 'final') {
    throw new Error(
      'Compiled team plan requires the final step to emit the final output',
    );
  }
  if (finalStep.nodeId !== snapshot.finalOutputNodeId) {
    throw new Error(
      'Compiled team plan final output node must match the terminal step',
    );
  }

  return Object.freeze({
    ...snapshot,
    steps: Object.freeze(steps),
  });
}
