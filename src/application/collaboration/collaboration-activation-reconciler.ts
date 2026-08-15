import { orderedWorkItems } from '../../domain/collaboration/collaboration.js';
import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';
import type { Task } from '../../domain/tasks/task.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import { TeamExecutionError } from '../ports/team-execution-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import { isTeamCompletionApprovalPending } from '../teams/team-policy-evaluator.js';
import { CollaborationActivationPlanner } from './collaboration-activation-planner.js';
import { TaskRunCollaborationActivationAdapter } from './task-run-collaboration-activation-adapter.js';

export interface CollaborationActivationKick {
  kick(rootTaskId: string, owner: OwnerScope, parentTask?: Task): void;
}

/**
 * Reconciles durable Workboard/Mailbox facts into canonical Task/Run turns.
 * Delivery is provider-neutral and restart-safe: a failed best-effort kick does
 * not change mutation success, and later reconciliation recomputes from facts.
 */
export class CollaborationActivationReconciler
  implements CollaborationActivationKick
{
  readonly #planner = new CollaborationActivationPlanner();
  readonly #adapter: TaskRunCollaborationActivationAdapter;

  public constructor(
    private readonly messages: TeamMessageRepository,
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    admission: AdmissionRepository,
    private readonly logger?: Logger,
    now: () => Date = () => new Date(),
  ) {
    this.#adapter = new TaskRunCollaborationActivationAdapter(
      tasks,
      admission,
      executions,
      now,
    );
  }

  public kick(rootTaskId: string, owner: OwnerScope, parentTask?: Task): void {
    void this.reconcileForRootTask(
      rootTaskId,
      owner,
      parentTask ? { parentTask } : {},
    ).catch((error) => {
      this.logger?.log('warn', 'collaboration.activation.kick_failed', {
        root_task_id: rootTaskId,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  }

  public async reconcilePendingRoots(): Promise<number> {
    const roots = new Map<string, { rootTaskId: string; owner: OwnerScope }>();
    for (const root of await this.messages.listQueuedWakeRoots())
      roots.set(rootKey(root.rootTaskId, root.owner), root);
    if (this.executions.listActiveTeamRunRoots) {
      for (const root of await this.executions.listActiveTeamRunRoots())
        roots.set(rootKey(root.rootTaskId, root.owner), root);
    }
    let materialized = 0;
    for (const root of roots.values())
      materialized += await this.reconcileForRootTask(
        root.rootTaskId,
        root.owner,
      );
    return materialized;
  }

  public async reconcileForRootTask(
    rootTaskId: string,
    owner: OwnerScope,
    options: { readonly parentTask?: Task } = {},
  ): Promise<number> {
    let materialized = 0;
    const maxPasses = COLLABORATION_LIMITS.maxWorkItems + 3;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      try {
        const changed = await this.reconcileOne(
          rootTaskId,
          owner,
          options.parentTask,
        );
        if (!changed) return materialized;
        materialized += 1;
      } catch (error) {
        if (isBenignLostClaim(error)) continue;
        if (
          error instanceof TeamExecutionError &&
          error.code === 'stale_state' &&
          pass + 1 < maxPasses
        )
          continue;
        throw error;
      }
    }
    return materialized;
  }

  private async reconcileOne(
    rootTaskId: string,
    owner: OwnerScope,
    parentTask?: Task,
  ): Promise<boolean> {
    const team = await this.executions.findTeamRunByRootTaskId(rootTaskId, owner);
    if (!team || team.status !== 'active') return false;
    const decision = team.completionRequestedByRunId
      ? await this.executions.findCompletionDecisionForRequest(
          team.id,
          team.completionRequestedByRunId,
          owner,
        )
      : null;
    if (isTeamCompletionApprovalPending(team, decision)) return false;

    const [members, attempts, workItems, dependencies] = await Promise.all([
      this.executions.findMembersByTeamRunId(team.id, owner),
      this.executions.findAttemptsByTeamRunId(team.id, owner),
      this.executions.findWorkItemsByTeamRunId(team.id, owner),
      this.executions.findWorkDependenciesByTeamRunId(team.id, owner),
    ]);
    const senderNameById = new Map(
      members.map((member) => [member.id, member.name]),
    );
    const taskRecords = this.tasks.findByRootTaskIdForOwner
      ? await this.tasks.findByRootTaskIdForOwner(team.rootTaskId, owner)
      : [];

    const lead = members.find((member) => member.role === 'lead');
    if (lead && isIdle(lead)) {
      const leadMessages = await this.messages.listQueuedForMember(
        team.id,
        lead.id,
        owner,
      );
      const finalReview = await this.readyForLeadReview(
        team,
        lead,
        attempts,
        workItems,
        dependencies,
        owner,
      );
      const plan = this.#planner.plan({
        participantId: lead.id,
        participantRole: 'lead',
        teamRevision: team.revision,
        messages: leadMessages,
        workItems,
        attempts,
        dependencies,
        finalReview,
        reviewFeedback:
          decision?.decision === 'reject' ? decision.feedback : null,
      });
      if (plan) {
        await this.materialize({
          team,
          member: lead,
          owner,
          plan,
          workItems,
          senderNameById,
          ...(parentTask ? { parentTask } : {}),
        });
        return true;
      }
    }

    const openActionable = orderedWorkItems(workItems).find((item) => {
      if (item.status !== 'open') return false;
      if (
        !dependencies
          .filter((edge) => edge.workItemId === item.id)
          .every(
            (edge) =>
              workItems.find(
                (candidate) => candidate.id === edge.dependsOnWorkItemId,
              )?.status === 'accepted',
          )
      )
        return false;
      const discoveryToken = `available:${item.id}:${item.updatedAt}`;
      return !taskRecords.some((record) =>
        record.task.logicalStepKey?.includes(discoveryToken),
      );
    });
    const memberCandidates = members
      .filter(
        (member) =>
          member.role === 'member' &&
          isIdle(member) &&
          !taskRecords.some(
            (record) =>
              record.task.teamMemberRunId === member.id &&
              !['completed', 'failed', 'cancelled'].includes(
                record.task.status,
              ),
          ),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      );
    const discoveryMember = openActionable
      ? memberCandidates.find(
          (member) => !hasUnresolvedOwnedWork(member.id, workItems, attempts),
        ) ?? null
      : null;

    for (const member of memberCandidates) {
      const queued = await this.messages.listQueuedForMember(
        team.id,
        member.id,
        owner,
      );
      const hasDiscovery =
        discoveryMember?.id === member.id && openActionable !== undefined;
      const plan = this.#planner.plan({
        participantId: member.id,
        participantRole: 'member',
        teamRevision: team.revision,
        messages: queued,
        workItems,
        attempts,
        dependencies,
        ...(hasDiscovery ? { workAvailableItem: openActionable } : {}),
      });
      if (!plan) continue;
      await this.materialize({
        team,
        member,
        owner,
        plan,
        workItems,
        senderNameById,
        ...(parentTask ? { parentTask } : {}),
      });
      return true;
    }
    return false;
  }

  private async materialize(
    input: Parameters<TaskRunCollaborationActivationAdapter['materialize']>[0],
  ): Promise<void> {
    try {
      const result = await this.#adapter.materialize(input);
      this.logger?.log('info', 'collaboration.activation.materialized', {
        team_run_id: input.team.id,
        participant_id: input.member.id,
        task_id: result.taskId,
        run_id: result.runId,
        cause_count: input.plan.activation.causes.length,
        priority: input.plan.activation.priority,
      });
    } catch (error) {
      if (isBenignLostClaim(error)) {
        this.logger?.log('info', 'collaboration.activation.claim_lost', {
          team_run_id: input.team.id,
          participant_id: input.member.id,
          dedupe_key: input.plan.activation.dedupeKey,
        });
        return;
      }
      throw error;
    }
  }

  private async readyForLeadReview(
    team: TeamRun,
    lead: TeamMemberRun,
    attempts: readonly TeamWorkItemAttempt[],
    workItems: readonly TeamWorkItem[],
    dependencies: readonly {
      readonly workItemId: string;
      readonly dependsOnWorkItemId: string;
    }[],
    owner: OwnerScope,
  ): Promise<boolean> {
    if (!this.tasks.findByRootTaskIdForOwner) return false;
    const taskRecords = await this.tasks.findByRootTaskIdForOwner(
      team.rootTaskId,
      owner,
    );
    if (
      taskRecords.some(
        (record) =>
          record.task.teamMemberRunId === lead.id &&
          record.task.teamTaskKind === 'lead_turn' &&
          !['completed', 'failed', 'cancelled'].includes(record.task.status),
      )
    )
      return false;

    const workById = new Map(workItems.map((work) => [work.id, work]));
    const latestByWorkItem = new Map<string, TeamWorkItemAttempt>();
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
          !attempt.executionTaskId ||
          !this.tasks.findByIdForOwner
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
          (record) =>
            !['completed', 'failed', 'cancelled'].includes(record.task.status),
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
}

function isIdle(member: TeamMemberRun): boolean {
  return !['active', 'stopped', 'failed'].includes(member.status);
}

function hasUnresolvedOwnedWork(
  memberId: string,
  workItems: readonly TeamWorkItem[],
  attempts: readonly TeamWorkItemAttempt[],
): boolean {
  const owned = new Set(
    workItems
      .filter(
        (item) =>
          item.ownerMemberId === memberId &&
          !['accepted', 'cancelled'].includes(item.status),
      )
      .map((item) => item.id),
  );
  return (
    owned.size > 0 ||
    attempts.some(
      (attempt) =>
        attempt.assigneeMemberId === memberId &&
        ['queued', 'running'].includes(attempt.status),
    )
  );
}

function rootKey(rootTaskId: string, owner: OwnerScope): string {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
    rootTaskId,
  ].join(':');
}

function isBenignLostClaim(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === '23505' &&
    candidate.constraint === 'tasks_root_logical_step_key_unique'
  );
}
