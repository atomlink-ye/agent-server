import { createRun, type Run } from '../../domain/runs/run.js';
import { createChildTask, type Task } from '../../domain/tasks/task.js';
import { createTeamRun, type TeamRun } from '../../domain/teams/team-run.js';
import type { TeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
import {
  createTeamMemberRun,
  activateMemberRun,
  type TeamMemberRun,
} from '../../domain/teams/team-member-run.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';
import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';
import type { CollaborationActivationReconciler } from '../collaboration/collaboration-activation-reconciler.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../ports/team-execution-repository.js';
import { TeamExecutionError } from '../ports/team-execution-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
} from '../tasks/root-task-input.js';
import {
  deriveAgenticLeadCommandPolicy,
  isTeamCompletionApprovalPending,
} from './team-policy-evaluator.js';

/**
 * Deterministic Team lifecycle owner. It decides whether a Team may fail or
 * complete, but Participant turns after the initial Lead are scheduled only by
 * CollaborationActivationReconciler.
 */
export class TeamDriver {
  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly admission: AdmissionRepository,
    private readonly messages?: Pick<
      TeamMessageRepository,
      'requeueDirectForFailedTask'
    >,
    private readonly reconciler?: Pick<
      CollaborationActivationReconciler,
      'reconcileForRootTask'
    >,
    private readonly now: () => Date = () => new Date(),
    private readonly options: {
      readonly completionApprovalRequired?: boolean;
    } = {},
  ) {}

  public async activateTeamRun(
    version: TeamVersion,
    claim: ClaimedRun,
    root: Task,
  ): Promise<Run> {
    const spec = version.spec;
    const owner = ownerOf(root);
    const team = createTeamRun({
      ...owner,
      rootTaskId: root.rootTaskId,
      rootRunId: claim.run.id,
      teamVersionId: version.id,
      environmentVersionId: spec.environmentVersionId,
      initialLeadTurn: true,
      completionApprovalRequired:
        this.options.completionApprovalRequired ?? false,
      now: this.now,
    });
    const lead = activateMemberRun(
      createTeamMemberRun({
        ...owner,
        teamRunId: team.id,
        name: spec.lead.name,
        role: 'lead',
        agentVersionId: spec.lead.agentVersionId,
        now: this.now,
      }),
      this.now,
    );
    const members = spec.roster.map((member) =>
      createTeamMemberRun({
        ...owner,
        teamRunId: team.id,
        name: member.name,
        role: 'member',
        agentVersionId: member.agentVersionId,
        now: this.now,
      }),
    );
    const leadTask = this.child(
      root,
      claim.run.id,
      lead,
      `lead:${team.id}:${lead.id}:turn:1`,
      `You are the Lead coordinating a bounded collaboration. Read collaboration_state and board_list, then make all currently useful decisions with the canonical Workboard/Mailbox tools. You may create multiple Work items, assign fixed participants or leave Work open for explicit claim, review submitted Work, and call collaboration_finish only when the required board is accepted. Do not wait for participants that are already running.\n\nGoal: ${safeText(claim.run.prompt)}\nSafe board snapshot: no Work items yet\nLimits: max ${COLLABORATION_LIMITS.maxWorkItems} Work items, max ${COLLABORATION_LIMITS.maxAttemptsPerItem} attempts per Work item, max ${COLLABORATION_LIMITS.maxLeadTurns} Lead turns.`,
      lead.agentVersionId,
      'lead_turn',
      1,
    );
    const leadRun = createRun(claim.run.prompt, { now: this.now });
    await this.executions.createTeamRun(team);
    await this.executions.createMemberRun(lead);
    for (const member of members) await this.executions.createMemberRun(member);
    if (!this.runs.releaseClaimedToWaiting)
      throw new Error('Waiting Run persistence is unavailable.');
    return this.admission.withTransaction(async (tx) => {
      await tx.tasks.save(leadTask);
      await tx.runs.save(leadRun, { taskId: leadTask.id, attempt: 1 });
      await tx.enqueueRunDispatch(leadRun.id, leadRun.createdAt);
      return this.runs.releaseClaimedToWaiting!(claim);
    });
  }

  public async decideCompletion(
    input:
      | {
          readonly teamRunId: string;
          readonly expectedRevision: number;
          readonly owner: OwnerScope;
          readonly decidedBy: string;
          readonly decision: 'approve';
        }
      | {
          readonly teamRunId: string;
          readonly expectedRevision: number;
          readonly owner: OwnerScope;
          readonly decidedBy: string;
          readonly decision: 'reject';
          readonly feedback: string;
          readonly workItemIds: readonly string[];
        },
  ): Promise<{ decision: TeamCompletionDecision; team: TeamRun }> {
    const team = await this.executions.findTeamRunById(
      input.teamRunId,
      input.owner,
    );
    if (
      !team ||
      !team.completionApprovalRequired ||
      !team.completionRequestedByRunId
    )
      throw new TeamExecutionError('invalid_transition');
    const requestRun = await this.runs.findByIdForOwner(
      team.completionRequestedByRunId,
      input.owner,
    );
    const finalText = requestRun?.result?.text?.trim();
    if (!requestRun || requestRun.status !== 'succeeded' || !finalText)
      throw new TeamExecutionError('invalid_transition');
    const decidedAt = this.now().toISOString();
    if (input.decision === 'approve') {
      const teamAfter = await this.executions.completeTeamRunAtomically({
        teamRunId: team.id,
        rootRunId: team.rootRunId,
        rootTaskId: team.rootTaskId,
        finalText,
        owner: input.owner,
        updatedAt: decidedAt,
        leadRunId: team.completionRequestedByRunId,
        approvalDecision: {
          expectedRevision: input.expectedRevision,
          decidedBy: input.decidedBy,
          decidedAt,
        },
      });
      const decision = await this.executions.findCompletionDecisionForRequest(
        team.id,
        team.completionRequestedByRunId,
        input.owner,
      );
      if (!decision) throw new TeamExecutionError('stale_state');
      return { team: teamAfter, decision };
    }

    const result = await this.admission.withTransaction(async (tx) => {
      if (!tx.teamExecutions)
        throw new Error(
          'Transaction-scoped Team execution persistence is required.',
        );
      const rejection =
        await tx.teamExecutions.recordCompletionRejectionInTransaction({
          teamRunId: team.id,
          completionRequestedByRunId: team.completionRequestedByRunId!,
          feedback: input.feedback,
          workItemIds: input.workItemIds,
          decidedBy: input.decidedBy,
          decidedAt,
          expectedRevision: input.expectedRevision,
          owner: input.owner,
        });
      return { decision: rejection.decision, team: rejection.team };
    });
    await this.reconciler?.reconcileForRootTask(team.rootTaskId, input.owner);
    return result;
  }

  public async handleTerminalRun(input: {
    team: TeamRun;
    task: Task;
    run: Run;
  }): Promise<void> {
    const owner = ownerOf(input.task);
    if (
      input.task.teamTaskKind !== 'lead_turn' &&
      input.task.teamTaskKind !== 'work_attempt' &&
      input.task.teamTaskKind !== 'direct_message'
    )
      throw new Error('Collaboration child task is missing explicit task kind.');

    if (input.task.teamTaskKind === 'direct_message') {
      if (
        input.run.status !== 'succeeded' &&
        input.task.inputTeamMessageIds?.length
      )
        await this.messages?.requeueDirectForFailedTask({
          messageIds: input.task.inputTeamMessageIds,
          taskId: input.task.id,
          owner,
        });
      await this.reconciler?.reconcileForRootTask(
        input.team.rootTaskId,
        owner,
        { parentTask: input.task },
      );
      return;
    }

    if (
      input.task.teamTaskKind === 'lead_turn' &&
      input.run.status !== 'succeeded'
    ) {
      await this.executions.failTeamRunAtomically({
        teamRunId: input.team.id,
        rootRunId: input.team.rootRunId,
        rootTaskId: input.team.rootTaskId,
        owner,
        updatedAt: this.now().toISOString(),
        stopReason: 'lead_run_failed',
        failure: {
          code: 'runtime_execution_failed',
          message: 'The Team Lead could not complete its turn.',
        },
      });
      return;
    }

    const attempts = await this.executions.findAttemptsByTeamRunId(
      input.team.id,
      owner,
    );
    if (input.task.teamTaskKind === 'work_attempt') {
      const attempt = attempts.find(
        (candidate) => candidate.executionTaskId === input.task.id,
      );
      if (!attempt) throw new Error('Collaboration work attempt linkage is missing.');
      if (input.run.status === 'succeeded') {
        if (attempt.status === 'running') {
          const failedTeam = await this.executions.failTeamRunAtomically({
            teamRunId: input.team.id,
            rootRunId: input.team.rootRunId,
            rootTaskId: input.team.rootTaskId,
            owner,
            updatedAt: this.now().toISOString(),
            stopReason: 'succeeded_without_submit',
            attemptId: attempt.id,
            childTaskId: input.task.id,
            childRunId: input.run.id,
            failure: {
              code: 'runtime_execution_failed',
              message:
                'The runtime completed successfully yet required board_submit did not occur.',
            },
          });
          if (failedTeam.status !== 'active') return;
        }
      } else if (
        attempt.status !== 'completed' &&
        attempt.status !== 'failed'
      ) {
        await this.executions.updateAttemptStatus(
          attempt.id,
          'failed',
          null,
          owner,
        );
      }
    }

    const fresh = await this.executions.findTeamRunById(input.team.id, owner);
    if (!fresh || fresh.status !== 'active') return;
    const currentDecision = await this.currentCompletionDecision(fresh, owner);
    if (isTeamCompletionApprovalPending(fresh, currentDecision)) return;

    if (input.task.teamTaskKind === 'lead_turn') {
      if (
        input.task.teamSequence === null ||
        input.task.teamSequence === undefined ||
        input.task.teamSequence !== fresh.leadTurnCount
      )
        return;
      const currentAttempts = await this.executions.findAttemptsByTeamRunId(
        fresh.id,
        owner,
      );
      if (
        fresh.controlState === 'lead_running' &&
        fresh.completionRequestedByRunId === null
      ) {
        const workItems = await this.executions.findWorkItemsByTeamRunId(
          fresh.id,
          owner,
        );
        const policy = deriveAgenticLeadCommandPolicy(
          fresh,
          workItems,
          currentAttempts,
          currentDecision,
        );
        if (
          policy.allowedCommands.length > 0 &&
          !policy.allowedCommands.includes('board_cancel')
        ) {
          try {
            await this.executions.failTeamRunAtomically({
              teamRunId: fresh.id,
              rootRunId: fresh.rootRunId,
              rootTaskId: fresh.rootTaskId,
              owner,
              updatedAt: this.now().toISOString(),
              stopReason: 'lead_no_progress',
              expectedRevision: fresh.revision,
              failure: {
                code: 'runtime_execution_failed',
                message: 'The Team Lead made no durable control progress.',
              },
            });
          } catch (error) {
            if (
              error instanceof TeamExecutionError &&
              error.code === 'stale_state'
            )
              return;
            throw error;
          }
          return;
        }
      }

      if (fresh.completionRequestedByRunId) {
        await this.reconciler?.reconcileForRootTask(
          fresh.rootTaskId,
          owner,
          { parentTask: input.task },
        );
        const after = await this.executions.findAttemptsByTeamRunId(
          fresh.id,
          owner,
        );
        if (after.some((attempt) => !['completed', 'failed'].includes(attempt.status)))
          return;
        if (currentDecision?.decision === 'reject') {
          await this.reconciler?.reconcileForRootTask(
            fresh.rootTaskId,
            owner,
            { parentTask: input.task },
          );
          return;
        }
        const finalText = input.run.result?.text?.trim();
        if (!finalText) return;
        if (fresh.completionApprovalRequired) return;
        await this.executions.completeTeamRunAtomically({
          teamRunId: fresh.id,
          rootRunId: fresh.rootRunId,
          rootTaskId: fresh.rootTaskId,
          finalText,
          owner,
          updatedAt: this.now().toISOString(),
          leadRunId: input.run.id,
        });
        return;
      }
    }

    await this.reconciler?.reconcileForRootTask(
      fresh.rootTaskId,
      owner,
      { parentTask: input.task },
    );
  }

  private async currentCompletionDecision(
    team: TeamRun,
    owner: OwnerScope,
  ): Promise<TeamCompletionDecision | null> {
    if (!team.completionRequestedByRunId) return null;
    return this.executions.findCompletionDecisionForRequest(
      team.id,
      team.completionRequestedByRunId,
      owner,
    );
  }

  private child(
    parent: Task,
    parentRunId: string,
    member: TeamMemberRun,
    key: string,
    prompt: string,
    agentVersionId: string,
    kind: 'lead_turn' | 'work_attempt' | 'direct_message' = 'lead_turn',
    sequence = 0,
  ): Task {
    return createChildTask({
      tenantId: parent.tenantId,
      workspaceId: parent.workspaceId,
      principalType: parent.principalType,
      principalId: parent.principalId,
      policySnapshotVersion: parent.policySnapshotVersion,
      rootTaskId: parent.rootTaskId,
      parentTaskId: parent.id,
      parentRunId,
      teamMemberRunId: member.id,
      teamSequence: sequence,
      invokableKind: 'agent',
      invokableVersionId: agentVersionId,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt }),
      inputFingerprint: fingerprintRootTaskRunRequest({ prompt }),
      logicalStepKey: key,
      nodePath: key,
      teamTaskKind: kind,
      now: this.now,
    });
  }
}

function safeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 4096);
}

function ownerOf(task: Task): OwnerScope {
  return {
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    principalType: task.principalType,
    principalId: task.principalId,
  };
}
