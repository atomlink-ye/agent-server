import { describe, expect, it, vi } from 'vitest';
import { createRootTask, type Task } from '../../domain/tasks/task.js';
import { createRun, type Run } from '../../domain/runs/run.js';
import { createTeamRun, type TeamRun } from '../../domain/teams/team-run.js';
import { TeamDriver } from './team-driver.js';

const now = () => new Date('2026-08-08T00:00:00.000Z');

function futureDriver(
  executions: Record<string, unknown>,
  options?: { completionApprovalRequired: boolean },
) {
  const Driver = TeamDriver as unknown as new (
    ...args: unknown[]
  ) => TeamDriver;
  return new Driver(
    executions,
    {} as never,
    {
      releaseClaimedToWaiting: vi.fn(async (claim) => claim.run),
    },
    {
      withTransaction: vi.fn(async (work) =>
        work({
          tasks: { save: vi.fn(async () => undefined) },
          runs: { save: vi.fn(async () => undefined) },
          enqueueRunDispatch: vi.fn(async () => undefined),
        } as never),
      ),
    },
    undefined,
    { reconcileForRootTask: vi.fn(async () => undefined) },
    now,
    options,
  );
}

function leadTask(team: TeamRun): Task {
  return {
    id: 'lead-task-1',
    tenantId: team.tenantId,
    workspaceId: team.workspaceId,
    principalType: team.principalType,
    principalId: team.principalId,
    policySnapshotVersion: 'policy-1',
    rootTaskId: team.rootTaskId,
    parentTaskId: team.rootTaskId,
    parentRunId: team.rootRunId,
    depth: 1,
    logicalStepKey: 'lead-turn-1',
    nodePath: 'lead-turn-1',
    status: 'completed',
    ingress: 'api',
    originRef: null,
    invokableKind: 'agent',
    invokableVersionId: 'agent-version-1',
    inputSnapshotRef: 'snapshot',
    inputFingerprint: 'fingerprint',
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    teamMemberRunId: 'lead-member-1',
    teamSequence: team.leadTurnCount,
    teamTaskKind: 'lead_turn',
  };
}

function teamRun(overrides: Partial<TeamRun> = {}): TeamRun {
  return {
    ...createTeamRun({
      id: 'team-run-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      rootTaskId: 'root-task-1',
      rootRunId: 'root-run-1',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      initialLeadTurn: true,
      now,
    }),
    ...overrides,
  } as TeamRun;
}

function settledAttempts() {
  return [
    {
      id: 'attempt-1',
      workItemId: 'work-1',
      teamRunId: 'team-run-1',
      attemptNo: 1,
      assigneeMemberId: 'member-1',
      requestedByLeadTaskId: 'lead-task-1',
      feedback: null,
      executionTaskId: 'work-task-1',
      status: 'completed',
      resultSummary: 'done',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      completedAt: now().toISOString(),
    },
  ];
}

describe('TeamDriver completion approval', () => {
  it('activation option true passes the approval requirement snapshot to createTeamRun', async () => {
    const executions = {
      createTeamRun: vi.fn(async () => undefined),
      createMemberRun: vi.fn(async () => undefined),
    };
    const driver = futureDriver(executions, {
      completionApprovalRequired: true,
    });
    const root = createRootTask({
      id: 'root-task-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      policySnapshotVersion: 'policy-1',
      invokableKind: 'team',
      invokableVersionId: 'team-version-1',
      inputSnapshotRef: 'snapshot',
      inputFingerprint: 'fingerprint',
      ingress: 'api',
      originRef: null,
      now,
    });
    const claim = {
      run: createRun('goal', { id: 'root-run-1', now }),
      taskId: root.id,
      attempt: 1,
      workerId: 'worker-1',
      activationId: 'activation-1',
      fencingToken: 1,
      leaseExpiresAt: now().toISOString(),
    };

    await driver.activateTeamRun(
      {
        id: 'team-version-1',
        definitionId: 'definition-1',
        tenantId: root.tenantId,
        workspaceId: root.workspaceId,
        principalType: root.principalType,
        principalId: root.principalId,
        status: 'published',
        name: 'team',
        description: null,
        spec: {
          lead: { name: 'Lead', agentVersionId: 'lead-agent-1' },
          roster: [{ name: 'Member', agentVersionId: 'member-agent-1' }],
          environmentVersionId: 'environment-version-1',
        },
        environmentVersionId: 'environment-version-1',
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
        publishedAt: now().toISOString(),
      },
      claim,
      root,
    );

    expect(executions.createTeamRun).toHaveBeenCalledWith(
      expect.objectContaining({ completionApprovalRequired: true }),
    );
  });

  it('does not complete a successful Lead when approval is required', async () => {
    const team = teamRun({
      completionApprovalRequired: true,
      completionRequestedByRunId: 'lead-run-1',
    });
    const executions = {
      findAttemptsByTeamRunId: vi.fn(async () => settledAttempts()),
      findTeamRunById: vi.fn(async () => team),
      findCompletionDecisionForRequest: vi.fn(async () => null),
      completeTeamRunAtomically: vi.fn(async () => team),
    };
    const driver = futureDriver(executions, {
      completionApprovalRequired: true,
    });
    const task = leadTask(team);
    const run = {
      ...createRun('lead turn', { id: 'lead-run-1', now }),
      status: 'succeeded',
      result: { text: 'final answer' },
    } as Run;

    await driver.handleTerminalRun({ team, task, run });

    expect(executions.completeTeamRunAtomically).not.toHaveBeenCalled();
  });

  it('completes once when approval is disabled or omitted', async () => {
    const team = teamRun({ completionRequestedByRunId: 'lead-run-1' });
    const executions = {
      findAttemptsByTeamRunId: vi.fn(async () => settledAttempts()),
      findTeamRunById: vi.fn(async () => team),
      findCompletionDecisionForRequest: vi.fn(async () => null),
      completeTeamRunAtomically: vi.fn(async () => team),
    };
    const driver = futureDriver(executions, {
      completionApprovalRequired: false,
    });
    const task = leadTask(team);
    const run = {
      ...createRun('lead turn', { id: 'lead-run-1', now }),
      status: 'succeeded',
      result: { text: 'final answer' },
    } as Run;

    await driver.handleTerminalRun({ team, task, run });

    expect(executions.completeTeamRunAtomically).toHaveBeenCalledTimes(1);
  });
});
