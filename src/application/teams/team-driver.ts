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
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type {
  AdmissionRepository,
  AdmissionTransaction,
} from '../ports/admission-repository.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../ports/team-execution-repository.js';
import { TeamExecutionError } from '../ports/team-execution-repository.js';
import type { TeamWakeReconciler } from './team-wake-reconciler.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import { terminalTaskStatuses } from '../../domain/tasks/task-status.js';
import {
  AGENTIC_TEAM_LIMITS,
  deriveAgenticLeadCommandPolicy,
  isTeamCompletionApprovalPending,
} from './team-policy-evaluator.js';

export class TeamDriver {
  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly admission: AdmissionRepository,
    private readonly messages?: Pick<
      TeamMessageRepository,
      'markDirectDelivered'
    >,
    private readonly reconciler?: Pick<
      TeamWakeReconciler,
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
    const members = spec.roster.map((m) =>
      createTeamMemberRun({
        ...owner,
        teamRunId: team.id,
        name: m.name,
        role: 'member',
        agentVersionId: m.agentVersionId,
        now: this.now,
      }),
    );
    const leadTask = this.child(
      root,
      claim.run.id,
      lead,
      `lead:${team.id}:${lead.id}:turn:1`,
      `You are the Lead coordinating a bounded team. Review the goal and safe board snapshot, then make all decisions currently needed in this turn. You may create multiple Work items, assign the fixed roster members, accept or request changes on multiple completed Work items, and finish when every Work item is accepted. Do not wait for running members during this turn.\n\nGoal: ${safeText(claim.run.prompt)}\nSafe board snapshot: no Work items yet\nLimits: max ${AGENTIC_TEAM_LIMITS.maxWorkItems} Work items, max ${AGENTIC_TEAM_LIMITS.maxAttemptsPerItem} attempts per Work item, max ${AGENTIC_TEAM_LIMITS.maxLeadTurns} Lead turns.`,
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
    const waiting = await this.admission.withTransaction(async (tx) => {
      await tx.tasks.save(leadTask);
      await tx.runs.save(leadRun, { taskId: leadTask.id, attempt: 1 });
      await tx.enqueueRunDispatch(leadRun.id, leadRun.createdAt);
      return this.runs.releaseClaimedToWaiting!(claim);
    });
    return waiting;
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

    return this.admission.withTransaction(async (tx) => {
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
      if (rejection.recorded === false)
        return { decision: rejection.decision, team: rejection.team };

      const rootTask = (
        await tx.tasks.findByIdForOwner(team.rootTaskId, input.owner)
      )?.task;
      if (!rootTask) throw new Error('Team root task is missing.');
      const prompt = this.reviewPrompt(rejection.decision);
      const next = await this.scheduleLead(
        rejection.team,
        rootTask,
        input.owner,
        prompt,
        tx,
      );
      if (next === null) throw new TeamExecutionError('conflict');
      return { decision: rejection.decision, team: next };
    });
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
      throw new Error('Agentic Team child task is missing explicit task kind.');
    if (input.task.teamTaskKind === 'direct_message') {
      if (!input.task.sourceTeamMessageId)
        throw new Error('Direct Team message linkage is missing.');
      if (input.run.status === 'succeeded') {
        if (!this.messages)
          throw new Error('Team message delivery is unavailable.');
        const delivered = await this.messages.markDirectDelivered({
          messageId: input.task.sourceTeamMessageId,
          taskId: input.task.id,
          owner,
        });
        if (!delivered)
          throw new Error('Direct Team message delivery is stale.');
        const fresh = await this.executions.findTeamRunById(
          input.team.id,
          owner,
        );
        if (!fresh || fresh.status !== 'active') return;
        const decision = await this.currentCompletionDecision(fresh, owner);
        if (isTeamCompletionApprovalPending(fresh, decision)) return;
        const attempts = await this.executions.findAttemptsByTeamRunId(
          fresh.id,
          owner,
        );
        if (!(await this.readyForLeadReview(fresh, attempts, owner))) return;
        const lead = (
          await this.executions.findMembersByTeamRunId(fresh.id, owner)
        ).find((member) => member.role === 'lead');
        if (!lead) throw new Error('Agentic Team lead member is missing.');
        await this.scheduleLead(
          fresh,
          input.task,
          owner,
          this.reviewPrompt(decision),
        );
      }
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
      const attempt = attempts.find((a) => a.executionTaskId === input.task.id);
      if (!attempt) throw new Error('Agentic work attempt linkage is missing.');
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
                'The runtime completed successfully yet required canonical work submit did not occur.',
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
    const currentAttempts = await this.executions.findAttemptsByTeamRunId(
      fresh.id,
      owner,
    );
    const currentDecision = await this.currentCompletionDecision(fresh, owner);
    if (isTeamCompletionApprovalPending(fresh, currentDecision)) return;
    if (input.task.teamTaskKind === 'lead_turn') {
      if (
        input.task.teamSequence === null ||
        input.task.teamSequence === undefined ||
        input.task.teamSequence !== fresh.leadTurnCount
      )
        return;
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
          !policy.allowedCommands.includes('team_work_cancel')
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
        // A completion request may arrive in the same Lead turn as the final
        // assignments. Materialize those queued attempts before deciding that
        // the Team is complete; otherwise the request can strand work forever.
        if (isTeamCompletionApprovalPending(fresh, currentDecision)) return;
        await this.materializeQueuedAttempts(fresh, owner);
        const after = await this.executions.findAttemptsByTeamRunId(
          fresh.id,
          owner,
        );
        if (after.some((a) => !['completed', 'failed'].includes(a.status)))
          return;
        if (currentDecision?.decision === 'reject') {
          if (!(await this.readyForLeadReview(fresh, after, owner))) return;
          await this.scheduleLead(
            fresh,
            input.task,
            owner,
            this.reviewPrompt(currentDecision),
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
      await this.materializeQueuedAttempts(fresh, owner);
      const after = await this.executions.findAttemptsByTeamRunId(
        fresh.id,
        owner,
      );
      if (!(await this.readyForLeadReview(fresh, after, owner))) return;
      await this.scheduleLead(
        fresh,
        input.task,
        owner,
        this.reviewPrompt(currentDecision),
      );
    } else if (await this.readyForLeadReview(fresh, currentAttempts, owner)) {
      const lead = (
        await this.executions.findMembersByTeamRunId(fresh.id, owner)
      ).find((m) => m.role === 'lead');
      if (!lead) throw new Error('Agentic Team lead member is missing.');
      await this.scheduleLead(
        fresh,
        input.task,
        owner,
        this.reviewPrompt(currentDecision),
      );
    }
  }

  private async readyForLeadReview(
    team: TeamRun,
    attempts: readonly TeamWorkItemAttempt[],
    owner: OwnerScope,
  ): Promise<boolean> {
    const [members, taskRecords, workItems, dependencies] = await Promise.all([
      this.executions.findMembersByTeamRunId(team.id, owner),
      this.tasks.findByRootTaskIdForOwner(team.rootTaskId, owner),
      this.executions.findWorkItemsByTeamRunId(team.id, owner),
      this.executions.findWorkDependenciesByTeamRunId(team.id, owner),
    ]);
    const lead = members.find((member) => member.role === 'lead');
    if (!lead) throw new Error('Agentic Team lead member is missing.');
    if (
      taskRecords.some(
        (record) =>
          record.task.teamMemberRunId === lead.id &&
          record.task.teamTaskKind === 'lead_turn' &&
          !terminalTaskStatuses.has(record.task.status),
      )
    )
      return false;
    const workById = new Map(workItems.map((work) => [work.id, work]));
    const latestByWorkItem = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) {
      const previous = latestByWorkItem.get(attempt.workItemId);
      if (!previous || attempt.attemptNo > previous.attemptNo)
        latestByWorkItem.set(attempt.workItemId, attempt);
    }
    const completedUnreviewed = [...latestByWorkItem.values()].some(
      (attempt) =>
        attempt.status === 'completed' &&
        Boolean(attempt.resultSummary?.trim()) &&
        workById.get(attempt.workItemId)?.status !== 'accepted',
    );
    const latestFailedUnreviewed = await Promise.all(
      [...latestByWorkItem.values()].map(async (attempt) => {
        const work = workById.get(attempt.workItemId);
        if (
          attempt.status !== 'failed' ||
          !work ||
          ['accepted', 'cancelled'].includes(work.status) ||
          !attempt.executionTaskId
        )
          return false;
        const record = await this.tasks.findByIdForOwner(
          attempt.executionTaskId,
          owner,
        );
        const code = record?.latestRun?.error?.code;
        return (
          code === 'runtime_timed_out' || code === 'runtime_execution_failed'
        );
      }),
    ).then((values) => values.some(Boolean));
    const emptyBoard = workItems.length === 0;
    const allResolved =
      workItems.length > 0 &&
      workItems.every((work) =>
        ['accepted', 'cancelled'].includes(work.status),
      );
    const queuedAwaitingReconcile = attempts.some(
      (attempt) =>
        attempt.status === 'queued' &&
        !attempt.executionTaskId &&
        dependencies
          .filter((edge) => edge.workItemId === attempt.workItemId)
          .every(
            (edge) =>
              workById.get(edge.dependsOnWorkItemId)?.status === 'accepted',
          ),
    );
    if (
      queuedAwaitingReconcile ||
      (!completedUnreviewed &&
        !latestFailedUnreviewed &&
        !emptyBoard &&
        !allResolved)
    )
      return false;
    if (allResolved) {
      const directTasks = taskRecords.filter(
        (record) =>
          record.task.teamTaskKind === 'direct_message' &&
          typeof record.task.teamMemberRunId === 'string',
      );
      if (
        directTasks.some(
          (record) => !terminalTaskStatuses.has(record.task.status),
        )
      )
        return false;
      if (
        directTasks.some(
          (record) =>
            record.latestRun !== null &&
            !['succeeded', 'failed', 'timed_out', 'cancelled'].includes(
              record.latestRun.status,
            ),
        )
      )
        return false;
    }
    return true;
  }

  private async materializeQueuedAttempts(team: TeamRun, owner: OwnerScope) {
    if (this.reconciler) {
      await this.reconciler.reconcileForRootTask(team.rootTaskId, owner);
      return;
    }
    throw new Error('Durable Team wake reconciler is required.');
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

  private reviewPrompt(decision: TeamCompletionDecision | null): string {
    if (decision?.decision === 'reject') {
      return `A reviewer rejected the completion request. Feedback: ${safeText(decision.feedback)}\n\nReview the safe board and address the requested changes before making another completion request.`;
    }
    return 'Review the safe board and latest member summaries. Request changes where acceptance criteria are not met, accept completed Work that meets the quality rubric, create any remaining useful Work, and finish only when all Work is accepted.';
  }

  private async scheduleLead(
    team: TeamRun,
    parent: Task,
    owner: OwnerScope,
    prompt: string,
    transaction?: AdmissionTransaction,
  ): Promise<TeamRun | null> {
    const schedule = async (
      tx: AdmissionTransaction,
    ): Promise<TeamRun | null> => {
      if (!tx.teamExecutions)
        throw new Error(
          'Transaction-scoped Team execution persistence is required.',
        );
      const executions = tx.teamExecutions;
      const lead = (
        await executions.findMembersByTeamRunId(team.id, owner)
      ).find((member) => member.role === 'lead');
      if (!lead) throw new Error('Agentic Team lead member is missing.');
      const teamTasks = await tx.tasks.findByRootTaskIdForOwner(
        team.rootTaskId,
        owner,
      );
      if (
        teamTasks.some(
          (record) =>
            record.task.teamMemberRunId === lead.id &&
            record.task.teamTaskKind === 'lead_turn' &&
            !terminalTaskStatuses.has(record.task.status),
        )
      )
        return null;
      const next = await executions.advanceAgenticLead({
        teamRunId: team.id,
        expectedRevision: team.revision,
        owner,
      });
      const task = this.child(
        parent,
        parent.parentRunId ?? team.rootRunId,
        lead,
        `lead:${team.id}:${lead.id}:turn:${next.leadTurnCount}`,
        `${prompt}\n\nYou are the Lead. Read the safe board, make all current decisions needed in this turn, and end the turn when those decisions are done. You may issue multiple valid canonical Team commands; do not wait for running members.`,
        lead.agentVersionId,
        'lead_turn',
        next.leadTurnCount,
      );
      const run = createRun(prompt, { now: this.now });
      await tx.tasks.save(task);
      await tx.runs.save(run, { taskId: task.id, attempt: 1 });
      await tx.enqueueRunDispatch(run.id, run.createdAt);
      return next;
    };
    try {
      return await (transaction
        ? schedule(transaction)
        : this.admission.withTransaction(schedule));
    } catch (error) {
      if (error instanceof TeamExecutionError && error.code === 'stale_state') {
        if (transaction) throw error;
        return null;
      }
      if (
        error instanceof TeamExecutionError &&
        error.code === 'limit_exceeded'
      ) {
        if (transaction) throw error;
        await this.executions.failTeamRunAtomically({
          teamRunId: team.id,
          rootRunId: team.rootRunId,
          rootTaskId: team.rootTaskId,
          owner,
          updatedAt: this.now().toISOString(),
          stopReason: 'lead_turn_limit',
          failure: {
            code: 'runtime_execution_failed',
            message: 'The Team reached its Lead turn limit without completing.',
          },
        });
        return null;
      }
      throw error;
    }
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
      inputFingerprint: parent.inputFingerprint,
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
function ownerOf(t: Task): OwnerScope {
  return {
    tenantId: t.tenantId,
    workspaceId: t.workspaceId,
    principalType: t.principalType,
    principalId: t.principalId,
  };
}
