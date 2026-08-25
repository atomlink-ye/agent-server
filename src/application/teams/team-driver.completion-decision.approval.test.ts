import { describe, expect, it, vi } from 'vitest';

import { createRun } from '../../domain/runs/run.js';
import { createTeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
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
    invokableKind: 'worker',
    teamMemberRunId: 'lead-member-decision',
    teamSequence: team.leadTurnCount,
    teamTaskKind: 'lead_turn',
  };
}

function setupDriver(initialTeam = makeTeam()) {
  let currentTeam = initialTeam;
  const completionRun = {
    ...createRun('final completion', {
      id: initialTeam.completionRequestedByRunId!,
      now,
    }),
    status: 'succeeded',
    result: { text: 'Final completion text' },
  } as ReturnType<typeof createRun>;
  const rejectDecision = createTeamCompletionDecision({
    id: 'decision-reject',
    ...owner,
    teamRunId: initialTeam.id,
    completionRequestedByRunId: initialTeam.completionRequestedByRunId!,
    decision: 'reject',
    feedback: 'Please revise the report.',
    decidedBy: 'reviewer-decision',
    decidedAt: now().toISOString(),
    leadTurnCountAtDecision: initialTeam.leadTurnCount,
    targets: [{ workItemId: 'work-decision', attemptNoAtDecision: 1 }],
  });
  const recordRejection = vi.fn(async (input: { feedback: string }) => {
    currentTeam = {
      ...currentTeam,
      revision: currentTeam.revision + 1,
      updatedAt: now().toISOString(),
    };
    return {
      recorded: true,
      decision: { ...rejectDecision, feedback: input.feedback },
      team: currentTeam,
    };
  });
  const withTransaction = vi.fn(async (work: (tx: any) => Promise<unknown>) =>
    work({
      teamExecutions: {
        recordCompletionRejectionInTransaction: recordRejection,
      },
    }),
  );
  const completeTeamRunAtomically = vi.fn(async () => currentTeam);
  const findCompletionDecisionForRequest = vi.fn<
    () => Promise<ReturnType<typeof createTeamCompletionDecision> | null>
  >(async () => null);
  const reconcileForRootTask = vi.fn(async () => 0);
  const executions = {
    findTeamRunById: vi.fn(async () => currentTeam),
    findAttemptsByTeamRunId: vi.fn(async () => []),
    findWorkItemsByTeamRunId: vi.fn(async () => []),
    findCompletionDecisionForRequest,
    completeTeamRunAtomically,
  };
  const driver = new TeamDriver(
    executions as never,
    {} as never,
    { findByIdForOwner: vi.fn(async () => completionRun) } as never,
    { withTransaction } as never,
    undefined,
    { reconcileForRootTask },
    now,
  );
  return {
    driver,
    recordRejection,
    completeTeamRunAtomically,
    findCompletionDecisionForRequest,
    reconcileForRootTask,
    get currentTeam() {
      return currentTeam;
    },
  };
}

describe('TeamDriver completion decision orchestration', () => {
  it('does not activate another Lead while completion approval is pending', async () => {
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
    expect(setup.reconcileForRootTask).not.toHaveBeenCalled();
  });

  it('persists rejection first then delegates next-turn scheduling to the unified reconciler', async () => {
    const setup = setupDriver();
    const feedback = 'Re-open the API contract and include source links.';
    const result = await setup.driver.decideCompletion({
      teamRunId: setup.currentTeam.id,
      expectedRevision: setup.currentTeam.revision,
      owner,
      decidedBy: 'reviewer-decision',
      decision: 'reject',
      feedback,
      workItemIds: ['work-decision'],
    });
    expect(setup.recordRejection).toHaveBeenCalledWith(
      expect.objectContaining({
        completionRequestedByRunId: 'completion-request-decision',
        feedback,
        workItemIds: ['work-decision'],
      }),
    );
    expect(result.decision.feedback).toBe(feedback);
    expect(setup.reconcileForRootTask).toHaveBeenCalledWith(
      setup.currentTeam.rootTaskId,
      owner,
    );
  });

  it('does not reconcile when rejection persistence fails', async () => {
    const setup = setupDriver();
    setup.recordRejection.mockRejectedValueOnce(
      new TeamExecutionError('invalid_transition'),
    );
    await expect(
      setup.driver.decideCompletion({
        teamRunId: setup.currentTeam.id,
        expectedRevision: setup.currentTeam.revision,
        owner,
        decidedBy: 'reviewer-decision',
        decision: 'reject',
        feedback: 'Invalid target.',
        workItemIds: ['work-decision'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(setup.reconcileForRootTask).not.toHaveBeenCalled();
  });

  it('approves through the atomic completion transition without another activation', async () => {
    const setup = setupDriver();
    setup.findCompletionDecisionForRequest.mockResolvedValueOnce(
      createTeamCompletionDecision({
        id: 'decision-approve',
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
      teamRunId: setup.currentTeam.id,
      expectedRevision: setup.currentTeam.revision,
      owner,
      decidedBy: 'reviewer-decision',
      decision: 'approve',
    });
    expect(setup.completeTeamRunAtomically).toHaveBeenCalledTimes(1);
    expect(setup.reconcileForRootTask).not.toHaveBeenCalled();
  });

  it('rejects approval when the approval gate is disabled', async () => {
    const setup = setupDriver(makeTeam({ completionApprovalRequired: false }));
    await expect(
      setup.driver.decideCompletion({
        teamRunId: setup.currentTeam.id,
        expectedRevision: setup.currentTeam.revision,
        owner,
        decidedBy: 'reviewer-decision',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(setup.completeTeamRunAtomically).not.toHaveBeenCalled();
  });
});
