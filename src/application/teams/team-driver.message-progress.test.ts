import { describe, expect, it, vi } from 'vitest';

import { createRun, transitionRun } from '../../domain/runs/run.js';
import { createChildTask } from '../../domain/tasks/task.js';
import { createTeamMemberRun } from '../../domain/teams/team-member-run.js';
import { createTeamMessage } from '../../domain/teams/team-message.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import { TeamDriver } from './team-driver.js';

describe('TeamDriver direct-message progress', () => {
  it('does not fail a Lead that sent a durable message to an active participant', async () => {
    const now = () => new Date('2026-08-16T01:00:00.000Z');
    const team = createTeamRun({
      id: 'team-message-progress',
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
    });
    const lead = createTeamMemberRun({
      id: 'lead-member',
      teamRunId: team.id,
      name: 'lead',
      role: 'lead',
      agentVersionId: 'agent-version-lead',
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      now,
    });
    const member = createTeamMemberRun({
      id: 'member-1',
      teamRunId: team.id,
      name: 'member',
      role: 'member',
      agentVersionId: 'agent-version-member',
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      now,
    });
    const leadTask = createChildTask({
      id: 'lead-task-1',
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      policySnapshotVersion: 'policy-1',
      rootTaskId: team.rootTaskId,
      parentTaskId: team.rootTaskId,
      parentRunId: team.rootRunId,
      invokableKind: 'agent',
      invokableVersionId: lead.agentVersionId,
      inputSnapshotRef: 'snapshot',
      inputFingerprint: 'fingerprint',
      logicalStepKey: `lead:${team.id}:${lead.id}:turn:1`,
      nodePath: 'lead-1',
      teamMemberRunId: lead.id,
      teamSequence: 1,
      teamTaskKind: 'lead_turn',
      now,
    });
    const leadRun = transitionRun(
      transitionRun(createRun('PING_FROM_LEAD', { id: 'lead-run-1', now }), 'running', {}, now),
      'succeeded',
      { result: { text: 'PING_FROM_LEAD sent.' } },
      now,
    );
    const failTeamRunAtomically = vi.fn();
    const reconcileForRootTask = vi.fn(async () => 0);
    const message = createTeamMessage({
      id: 'message-1',
      teamRunId: team.id,
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      senderMemberRunId: lead.id,
      recipientMemberRunId: member.id,
      kind: 'direct',
      dedupKey: 'message-send-lead-run-1',
      body: 'PING_FROM_LEAD',
      sourceTaskId: leadTask.id,
      sourceRunId: leadRun.id,
      now,
    });
    const listDirectForTeamRun = vi.fn(async () => [message]);
    const driver = new TeamDriver(
      {
        findTeamRunById: vi.fn(async () => team),
        findAttemptsByTeamRunId: vi.fn(async () => []),
        findWorkItemsByTeamRunId: vi.fn(async () => []),
        findMembersByTeamRunId: vi.fn(async () => [lead, member]),
        failTeamRunAtomically,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        listDirectForTeamRun,
        requeueDirectForFailedTask: vi.fn(async () => []),
      },
      { reconcileForRootTask },
      now,
    );

    await driver.handleTerminalRun({ team, task: leadTask, run: leadRun });

    expect(listDirectForTeamRun).toHaveBeenCalledWith(team.id, {
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
    });
    expect(failTeamRunAtomically).not.toHaveBeenCalled();
    expect(reconcileForRootTask).toHaveBeenCalledWith(
      team.rootTaskId,
      expect.any(Object),
      { parentTask: leadTask },
    );
  });
});
