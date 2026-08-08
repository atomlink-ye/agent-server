import { describe, expect, it, vi } from 'vitest';

import { decodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import { createRun } from '../../domain/runs/run.js';
import {
  createTeamCompletionDecision,
  type TeamCompletionDecision,
} from '../../domain/teams/team-completion-decision.js';
import { createTeamRun, type TeamRun } from '../../domain/teams/team-run.js';
import { createRootTask, type Task } from '../../domain/tasks/task.js';
import { TeamExecutionError } from '../ports/team-execution-repository.js';
import { TeamDriver } from './team-driver.js';

const now = () => new Date('2026-08-08T00:00:00.000Z');
const owner = {
  tenantId: 'tenant-decision',
  workspaceId: 'workspace-decision',
  principalType: 'user',
  principalId: 'user-decision',
} as const;

type DecisionInput =
  | {
      readonly teamRunId: string;
      readonly expectedRevision: number;
      readonly owner: typeof owner;
      readonly decidedBy: string;
      readonly decision: 'approve';
    }
  | {
      readonly teamRunId: string;
      readonly expectedRevision: number;
      readonly owner: typeof owner;
      readonly decidedBy: string;
      readonly decision: 'reject';
      readonly feedback: string;
      readonly workItemIds: readonly string[];
    };

type DecisionDriver = TeamDriver & {
  decideCompletion(input: DecisionInput): Promise<{
    readonly decision: ReturnType<typeof createTeamCompletionDecision>;
    readonly team: TeamRun;
  }>;
};

function makeTeam(overrides: Partial<TeamRun> = {}): TeamRun {
  return {
    ...createTeamRun({
      id: 'team-decision',
      ...owner,
      rootTaskId: 'root-decision',
      rootRunId: 'root-run-decision',
      teamVersionId: 'team-version-decision',
      environmentVersionId: 'environment-decision',
      initialLeadTurn: true,
      completionApprovalRequired: true,
      now,
    }),
    phase: 'lead_finalize',
    controlState: 'lead_running',
    completionRequestedByRunId: 'completion-request-decision',
    ...overrides,
  };
}

function makeRootTask(team: TeamRun): Task {
  return createRootTask({
    id: team.rootTaskId,
    ...owner,
    policySnapshotVersion: 'policy-decision',
    invokableKind: 'team',
    invokableVersionId: team.teamVersionId,
    inputSnapshotRef: 'snapshot:decision',
    inputFingerprint: 'fingerprint:decision',
    ingress: 'api',
    originRef: null,
    now,
  });
}

function makeDecision(
  team: TeamRun,
  feedback: string,
  leadTurnCountAtDecision = team.leadTurnCount,
) {
  return createTeamCompletionDecision({
    id: `decision-${leadTurnCountAtDecision}`,
    ...owner,
    teamRunId: team.id,
    completionRequestedByRunId: team.completionRequestedByRunId!,
    decision: 'reject',
    feedback,
    decidedBy: 'reviewer-decision',
    decidedAt: now().toISOString(),
    leadTurnCountAtDecision,
    targets: [{ workItemId: 'work-decision', attemptNoAtDecision: 1 }],
  });
}

function setupDriver(initialTeam = makeTeam()) {
  let currentTeam = initialTeam;
  const rootTask = makeRootTask(initialTeam);
  const completionRun = {
    ...createRun('final completion', {
      id: initialTeam.completionRequestedByRunId!,
      now,
    }),
    status: 'succeeded',
    result: { text: 'Final completion text' },
  } as ReturnType<typeof createRun>;
  const lead = {
    id: 'lead-member-decision',
    teamRunId: initialTeam.id,
    name: 'Lead',
    role: 'lead' as const,
    agentVersionId: 'lead-agent-decision',
    runtimeSessionId: null,
    status: 'active' as const,
    currentWorkItemId: null,
    ...owner,
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
  };
  const completedAttempt = {
    id: 'attempt-decision',
    workItemId: 'work-decision',
    teamRunId: initialTeam.id,
    attemptNo: 1,
    assigneeMemberId: 'member-decision',
    requestedByLeadTaskId: 'lead-task-decision',
    feedback: null,
    executionTaskId: 'work-task-decision',
    status: 'completed' as const,
    resultSummary: 'Completed work',
    ...owner,
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    completedAt: now().toISOString(),
  };
  const acceptedWork = {
    id: 'work-decision',
    teamRunId: initialTeam.id,
    subject: 'Decision work',
    description: 'Work under review',
    status: 'accepted' as const,
    ownerMemberId: 'member-decision',
    createdByMemberId: lead.id,
    completionSummary: 'Completed work',
    executionTaskId: 'work-task-decision',
    ...owner,
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    completedAt: now().toISOString(),
  };
  const saveTask = vi.fn(async (_task: Task) => undefined);
  const saveRun = vi.fn(async (_run: { prompt: string }) => undefined);
  const enqueue = vi.fn(async () => undefined);
  const recordRejection = vi.fn(
    async (input: { feedback: string; completionRequestedByRunId: string }) => {
      const decision = makeDecision(currentTeam, input.feedback);
      currentTeam = {
        ...currentTeam,
        revision: currentTeam.revision + 1,
        updatedAt: now().toISOString(),
      };
      return { recorded: true, decision, team: currentTeam };
    },
  );
  const advanceLead = vi.fn(async () => {
    currentTeam = {
      ...currentTeam,
      revision: currentTeam.revision + 1,
      leadTurnCount: currentTeam.leadTurnCount + 1,
      updatedAt: now().toISOString(),
    };
    return currentTeam;
  });
  const withTransaction = vi.fn(
    async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        tasks: {
          save: saveTask,
          findByIdForOwner: vi.fn(async () => ({
            task: rootTask,
            latestRun: null,
          })),
          findByRootTaskIdForOwner: vi.fn(async () => []),
        },
        runs: { save: saveRun },
        teamExecutions: {
          findMembersByTeamRunId: vi.fn(async () => [lead]),
          recordCompletionRejectionInTransaction: recordRejection,
          advanceAgenticLead: advanceLead,
        },
        enqueueRunDispatch: enqueue,
      }),
  );
  const completeTeamRunAtomically = vi.fn(async () => currentTeam);
  const latestDecision = vi.fn<() => Promise<TeamCompletionDecision | null>>(
    async () => null,
  );
  const executions = {
    findTeamRunById: vi.fn(async () => currentTeam),
    findMembersByTeamRunId: vi.fn(async () => [lead]),
    findAttemptsByTeamRunId: vi.fn(async () => [completedAttempt]),
    findWorkItemsByTeamRunId: vi.fn(async () => [acceptedWork]),
    findWorkDependenciesByTeamRunId: vi.fn(async () => []),
    findCompletionDecisionForRequest: latestDecision,
    findLatestCompletionDecision: latestDecision,
    completeTeamRunAtomically,
  };
  const taskRepository = {
    findById: vi.fn(async () => rootTask),
    findByRootTaskIdForOwner: vi.fn(async () => []),
  };
  const driver = new TeamDriver(
    executions as never,
    taskRepository as never,
    {
      findById: vi.fn(async () => completionRun),
      findByIdForOwner: vi.fn(async () => completionRun),
    } as never,
    { withTransaction } as never,
    undefined,
    { reconcileForRootTask: vi.fn(async () => 0) },
    now,
  ) as DecisionDriver;
  return {
    driver,
    withTransaction,
    recordRejection,
    advanceLead,
    completeTeamRunAtomically,
    saveTask,
    saveRun,
    enqueue,
    latestDecision,
    setCurrentTeam(next: TeamRun) {
      currentTeam = next;
    },
    get currentTeam() {
      return currentTeam;
    },
  };
}

function leadTerminalTask(team: TeamRun): Task {
  return {
    ...makeRootTask(team),
    id: 'lead-task-decision',
    parentTaskId: team.rootTaskId,
    parentRunId: team.rootRunId,
    depth: 1,
    logicalStepKey: 'lead-turn-decision',
    nodePath: 'lead-turn-decision',
    status: 'completed',
    invokableKind: 'agent',
    teamMemberRunId: 'lead-member-decision',
    teamSequence: team.leadTurnCount,
    teamTaskKind: 'lead_turn',
  };
}

describe('TeamDriver completion decision orchestration', () => {
  it('does not schedule an extra Lead while a completion request is pending approval', async () => {
    const setup = setupDriver();
    const run = {
      ...createRun('lead completion', { id: 'lead-run-decision', now }),
      status: 'succeeded' as const,
      result: { text: 'lead output' },
    };

    await setup.driver.handleTerminalRun({
      team: setup.currentTeam,
      task: leadTerminalTask(setup.currentTeam),
      run,
    });

    expect(setup.advanceLead).not.toHaveBeenCalled();
    expect(setup.saveTask).not.toHaveBeenCalled();
    expect(setup.saveRun).not.toHaveBeenCalled();
    expect(setup.enqueue).not.toHaveBeenCalled();
  });

  it('allows the matching latest reject to schedule the next Lead epoch', async () => {
    const setup = setupDriver();
    setup.latestDecision.mockResolvedValueOnce(
      makeDecision(setup.currentTeam, 'Re-open the rejected work.'),
    );
    const run = {
      ...createRun('lead completion', { id: 'lead-run-decision', now }),
      status: 'succeeded' as const,
      result: { text: 'lead output' },
    };

    await setup.driver.handleTerminalRun({
      team: setup.currentTeam,
      task: leadTerminalTask(setup.currentTeam),
      run,
    });

    expect(setup.advanceLead).toHaveBeenCalledTimes(1);
    expect(setup.saveTask).toHaveBeenCalledTimes(1);
    expect(setup.saveRun).toHaveBeenCalledTimes(1);
    expect(setup.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects with feedback and targets, then carries exact feedback into the next Lead prompt/context', async () => {
    const setup = setupDriver();
    const feedback = 'Re-open the API contract and include source links.';

    const result = await setup.driver.decideCompletion({
      teamRunId: 'team-decision',
      expectedRevision: setup.currentTeam.revision,
      owner,
      decidedBy: 'reviewer-decision',
      decision: 'reject',
      feedback,
      workItemIds: ['work-decision'],
    });

    expect(setup.withTransaction).toHaveBeenCalledTimes(1);
    expect(setup.recordRejection).toHaveBeenCalledWith(
      expect.objectContaining({
        teamRunId: 'team-decision',
        expectedRevision: 1,
        completionRequestedByRunId: 'completion-request-decision',
        feedback,
        workItemIds: ['work-decision'],
        decidedBy: 'reviewer-decision',
      }),
    );
    expect(result.decision.feedback).toBe(feedback);
    const savedTask = setup.saveTask.mock.calls.at(-1)?.[0] as Task;
    const savedRun = setup.saveRun.mock.calls.at(-1)?.[0] as { prompt: string };
    expect(
      decodeRootTaskRunRequestSnapshotRef(savedTask.inputSnapshotRef).prompt,
    ).toContain(feedback);
    expect(savedRun.prompt).toContain(feedback);
    expect(setup.enqueue).toHaveBeenCalledTimes(1);
  });

  it('keeps absolute monotonic Lead turn counts across two sequential rejects with a fresh epoch', async () => {
    const setup = setupDriver({
      ...makeTeam(),
      leadTurnCount: 7,
      revision: 10,
    });

    await setup.driver.decideCompletion({
      teamRunId: 'team-decision',
      expectedRevision: 10,
      owner,
      decidedBy: 'reviewer-decision',
      decision: 'reject',
      feedback: 'First rejection feedback.',
      workItemIds: ['work-decision'],
    });
    setup.setCurrentTeam({
      ...setup.currentTeam,
      completionRequestedByRunId: 'completion-request-decision-2',
      revision: setup.currentTeam.revision + 1,
    });
    await setup.driver.decideCompletion({
      teamRunId: 'team-decision',
      expectedRevision: 13,
      owner,
      decidedBy: 'reviewer-decision',
      decision: 'reject',
      feedback: 'Second rejection feedback.',
      workItemIds: ['work-decision'],
    });

    const savedTasks = setup.saveTask.mock.calls.map(([task]) => task as Task);
    expect(savedTasks.map((task) => task.teamSequence)).toEqual([8, 9]);
    expect(
      setup.recordRejection.mock.calls.map(
        ([input]) =>
          (input as { completionRequestedByRunId: string })
            .completionRequestedByRunId,
      ),
    ).toEqual(['completion-request-decision', 'completion-request-decision-2']);
    expect(setup.advanceLead).toHaveBeenCalledTimes(2);
    expect(setup.currentTeam.leadTurnCount).toBe(9);
  });

  it('approves by delegating to completeTeamRunAtomically exactly once', async () => {
    const setup = setupDriver();
    setup.latestDecision.mockResolvedValueOnce(
      createTeamCompletionDecision({
        id: 'approval-decision',
        ...owner,
        teamRunId: setup.currentTeam.id,
        completionRequestedByRunId:
          setup.currentTeam.completionRequestedByRunId!,
        decision: 'approve',
        feedback: null,
        decidedBy: 'reviewer-decision',
        decidedAt: now().toISOString(),
        leadTurnCountAtDecision: setup.currentTeam.leadTurnCount,
        targets: [],
      }),
    );

    await setup.driver.decideCompletion({
      teamRunId: 'team-decision',
      expectedRevision: setup.currentTeam.revision,
      owner,
      decidedBy: 'reviewer-decision',
      decision: 'approve',
    });

    expect(setup.completeTeamRunAtomically).toHaveBeenCalledTimes(1);
    expect(setup.completeTeamRunAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        teamRunId: 'team-decision',
        finalText: 'Final completion text',
        leadRunId: 'completion-request-decision',
        owner,
        approvalDecision: {
          expectedRevision: setup.currentTeam.revision,
          decidedBy: 'reviewer-decision',
          decidedAt: now().toISOString(),
        },
      }),
    );
    expect(setup.recordRejection).not.toHaveBeenCalled();
    expect(setup.withTransaction).not.toHaveBeenCalled();
  });

  it('bubbles invalid_target from rejection persistence without scheduling a Lead', async () => {
    const setup = setupDriver();
    const invalidTarget = new TeamExecutionError('invalid_target');
    setup.recordRejection.mockRejectedValueOnce(invalidTarget);

    await expect(
      setup.driver.decideCompletion({
        teamRunId: 'team-decision',
        expectedRevision: setup.currentTeam.revision,
        owner,
        decidedBy: 'reviewer-decision',
        decision: 'reject',
        feedback: 'Target the API contract.',
        workItemIds: ['missing-work'],
      }),
    ).rejects.toBe(invalidTarget);
    expect(setup.advanceLead).not.toHaveBeenCalled();
    expect(setup.saveTask).not.toHaveBeenCalled();
    expect(setup.saveRun).not.toHaveBeenCalled();
  });
});
