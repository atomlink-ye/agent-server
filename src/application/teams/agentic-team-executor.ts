import { createRun, type Run } from '../../domain/runs/run.js';
import { createChildTask, type Task } from '../../domain/tasks/task.js';
import { createTeamRun, type TeamRun } from '../../domain/teams/team-run.js';
import {
  createTeamMemberRun,
  activateMemberRun,
  type TeamMemberRun,
} from '../../domain/teams/team-member-run.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../ports/team-execution-repository.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import type { TeamEvidenceProvider } from '../ports/team-evidence-provider.js';

const LIMIT = 4;

export class AgenticTeamExecutor {
  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly admission: AdmissionRepository,
    private readonly evidence: TeamEvidenceProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async activateTeamRun(
    version: TeamVersion,
    claim: ClaimedRun,
    root: Task,
  ): Promise<Run> {
    const spec = version.collaborationSpec;
    if (!spec)
      throw new Error('Agentic Team version has no collaboration spec.');
    const owner = ownerOf(root);
    const team = createTeamRun({
      ...owner,
      rootTaskId: root.rootTaskId,
      rootRunId: claim.run.id,
      teamVersionId: version.id,
      environmentVersionId: spec.environmentVersionId,
      executionMode: 'agentic_mve',
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
      claim.run,
      lead,
      `lead:${team.id}:${lead.id}:turn:1`,
      `team_run_id: ${team.id}\n\nYou are the Lead. Review the objective and the empty WorkItem/Attempt snapshot below. Choose the single most valuable teammate for the next decision and call exactly one team_work_create_and_assign command. Then immediately return a short decision text and end this turn; do not inspect files, call another tool, or wait for members.\n\nObjective: ${claim.run.prompt}\n\nCurrent WorkItem/Attempt snapshot: empty.`,
      lead.agentVersionId,
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

  public async handleTerminalRun(input: {
    team: TeamRun;
    task: Task;
    run: Run;
  }): Promise<void> {
    if (input.team.executionMode !== 'agentic_mve') return;
    const owner = ownerOf(input.task);
    if (
      input.task.teamTaskKind !== 'lead_turn' &&
      input.task.teamTaskKind !== 'work_attempt'
    )
      throw new Error('Agentic Team child task is missing explicit task kind.');
    const attempts = await this.executions.findAttemptsByTeamRunId(
      input.team.id,
      owner,
    );
    if (input.task.teamTaskKind === 'work_attempt') {
      const attempt = attempts.find((a) => a.executionTaskId === input.task.id);
      if (!attempt) throw new Error('Agentic work attempt linkage is missing.');
      await this.executions.updateAttemptStatus(
        attempt.id,
        input.run.status === 'succeeded' ? 'completed' : 'failed',
        input.run.result?.text ?? null,
        owner,
      );
    } else if (input.run.status !== 'succeeded') {
      throw new Error('Agentic lead run failed.');
    }
    const fresh = await this.executions.findTeamRunById(input.team.id, owner);
    if (!fresh || fresh.status !== 'active') return;
    const currentAttempts = await this.executions.findAttemptsByTeamRunId(
      fresh.id,
      owner,
    );
    if (input.task.teamTaskKind === 'lead_turn') {
      if (fresh.completionRequestedByRunId) {
        // A completion request may arrive in the same Lead turn as the final
        // assignments. Materialize those queued attempts before deciding that
        // the Team is complete; otherwise the request can strand work forever.
        await this.materializeQueuedAttempts(
          fresh,
          input.task,
          currentAttempts,
          owner,
        );
        const after = await this.executions.findAttemptsByTeamRunId(
          fresh.id,
          owner,
        );
        if (after.some((a) => a.status !== 'completed')) return;
        await this.executions.completeTeamRunAtomically({
          teamRunId: fresh.id,
          rootRunId: fresh.rootRunId,
          rootTaskId: fresh.rootTaskId,
          finalText: input.run.result?.text ?? 'Team completed.',
          owner,
          updatedAt: this.now().toISOString(),
          completionIntent: 'agentic',
          executionMode: 'agentic_mve',
          leadRunId: input.run.id,
        });
        return;
      }
      await this.materializeQueuedAttempts(
        fresh,
        input.task,
        currentAttempts,
        owner,
      );
      const after = await this.executions.findAttemptsByTeamRunId(
        fresh.id,
        owner,
      );
      if (after.some((a) => a.status === 'queued' && a.executionTaskId)) return;
      if (
        after.length &&
        after.some((a) => a.status !== 'completed' && a.status !== 'failed')
      )
        return;
      await this.scheduleLead(
        fresh,
        input.task,
        owner,
        'Review evidence. If any work lacks event evidence, request exactly one rework; otherwise accept all work and request completion.',
      );
    } else if (
      currentAttempts.every(
        (a) => a.status === 'completed' || a.status === 'failed',
      )
    ) {
      const lead = (
        await this.executions.findMembersByTeamRunId(fresh.id, owner)
      ).find((m) => m.role === 'lead');
      if (!lead) throw new Error('Agentic Team lead member is missing.');
      await this.scheduleLead(
        fresh,
        input.task,
        owner,
        'Review the latest teammate evidence and apply the quality rubric.',
      );
    }
  }

  private async materializeQueuedAttempts(
    team: TeamRun,
    parent: Task,
    attempts: readonly {
      id: string;
      executionTaskId: string | null;
      status: string;
      assigneeMemberId: string;
      attemptNo: number;
      feedback: string | null;
    }[],
    owner: OwnerScope,
  ) {
    const members = await this.executions.findMembersByTeamRunId(
      team.id,
      owner,
    );
    for (const attempt of attempts.filter(
      (a) => a.status === 'queued' && !a.executionTaskId,
    )) {
      const member = members.find((m) => m.id === attempt.assigneeMemberId);
      if (!member) throw new Error('Agentic attempt assignee is missing.');
      const feedback = attempt.feedback
        ?.replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 512);
      const attemptPrompt =
        attempt.attemptNo === 1
          ? 'This is attempt 1. The provided snapshot evidence intentionally excludes event evidence; report that gap explicitly.'
          : feedback
            ? `This is attempt ${attempt.attemptNo}. Lead feedback: ${feedback} The provided evidence adds the requested event evidence; report the completed evidence summary.`
            : `This is attempt ${attempt.attemptNo}. No Lead feedback is available; return a concise report from the provided evidence.`;
      const evidence = this.evidence.getWorkAttemptEvidence({
        attemptNo: attempt.attemptNo,
        feedback: feedback ?? null,
      });
      const task = this.child(
        parent,
        {
          id: parent.parentRunId ?? team.rootRunId,
          prompt: parent.inputSnapshotRef,
        } as Run,
        member,
        `member:${team.id}:${member.id}:work_attempt:${attempt.id}`,
        `team_run_id: ${team.id}\n\nYou are completing assigned WorkItemAttempt ${attempt.attemptNo}. Lead feedback: ${feedback ?? '(none)'}\nProvided bounded synthetic evidence (use only this; do not call any tool, subagent, shell, search, read, write, or edit): ${JSON.stringify(evidence)}\n\n${attemptPrompt} Return a plain-text report based only on the provided evidence and immediately end the turn.`,
        member.agentVersionId,
        'work_attempt',
      );
      const run = createRun(`Work attempt ${attempt.id}`, { now: this.now });
      await this.admission.withTransaction(async (tx) => {
        await tx.tasks.save(task);
        await tx.runs.save(run, { taskId: task.id, attempt: 1 });
        await tx.enqueueRunDispatch(run.id, run.createdAt);
      });
      await this.executions.bindAttemptExecution(attempt.id, task.id, owner);
    }
  }

  private async scheduleLead(
    team: TeamRun,
    parent: Task,
    owner: OwnerScope,
    prompt: string,
  ) {
    if (team.leadTurnCount >= LIMIT)
      throw new Error('Agentic Team stopped: lead_turn_limit.');
    const next = await this.executions.advanceAgenticLead({
      teamRunId: team.id,
      expectedRevision: team.revision,
      owner,
    });
    const lead = (
      await this.executions.findMembersByTeamRunId(team.id, owner)
    ).find((m) => m.role === 'lead');
    if (!lead) throw new Error('Agentic Team lead member is missing.');
    const task = this.child(
      parent,
      {
        id: parent.parentRunId ?? team.rootRunId,
        prompt: parent.inputSnapshotRef,
      } as Run,
      lead,
      `lead:${team.id}:${lead.id}:turn:${next.leadTurnCount}`,
      `team_run_id: ${team.id}\n\n${prompt}`,
      lead.agentVersionId,
      'lead_turn',
    );
    const run = createRun(prompt, { now: this.now });
    await this.admission.withTransaction(async (tx) => {
      await tx.tasks.save(task);
      await tx.runs.save(run, { taskId: task.id, attempt: 1 });
      await tx.enqueueRunDispatch(run.id, run.createdAt);
    });
  }

  private child(
    parent: Task,
    parentRun: Run,
    member: TeamMemberRun,
    key: string,
    prompt: string,
    agentVersionId: string,
    kind: 'lead_turn' | 'work_attempt' = 'lead_turn',
  ): Task {
    return createChildTask({
      tenantId: parent.tenantId,
      workspaceId: parent.workspaceId,
      principalType: parent.principalType,
      principalId: parent.principalId,
      policySnapshotVersion: parent.policySnapshotVersion,
      rootTaskId: parent.rootTaskId,
      parentTaskId: parent.id,
      parentRunId: parentRun.id,
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
function ownerOf(t: Task): OwnerScope {
  return {
    tenantId: t.tenantId,
    workspaceId: t.workspaceId,
    principalType: t.principalType,
    principalId: t.principalId,
  };
}
