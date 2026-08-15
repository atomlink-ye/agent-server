import type { AdmissionRepository } from '../ports/admission-repository.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import { TeamExecutionError } from '../ports/team-execution-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import type { Logger } from '../../shared/observability/logger.js';
import { isTeamCompletionApprovalPending } from './team-policy-evaluator.js';
import { CollaborationActivationPlanner } from '../collaboration/collaboration-activation-planner.js';
import { TaskRunCollaborationActivationAdapter } from '../collaboration/task-run-collaboration-activation-adapter.js';

/**
 * Reconciles durable collaboration facts into canonical Task/Run activations.
 * It is intentionally provider-neutral: Paseo/session continuation belongs to
 * ExecuteRun + Execution Plane after a Task/Run is materialized.
 */
export class TeamWakeReconciler {
  readonly #planner = new CollaborationActivationPlanner();
  readonly #adapter: TaskRunCollaborationActivationAdapter;

  public constructor(
    private readonly messages: TeamMessageRepository,
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    admission: AdmissionRepository,
    now: () => Date = () => new Date(),
    private readonly logger?: Logger,
  ) {
    this.#adapter = new TaskRunCollaborationActivationAdapter(
      tasks,
      admission,
      now,
    );
  }

  public async reconcileQueuedWakeRoots(): Promise<number> {
    let materialized = 0;
    for (const root of await this.messages.listQueuedWakeRoots())
      materialized += await this.reconcileForRootTask(root.rootTaskId, root.owner);
    return materialized;
  }

  public async reconcileForRootTask(
    rootTaskId: string,
    owner: OwnerScope,
  ): Promise<number> {
    let materialized = 0;
    // A Task materialization fences the Team revision. One retry allows the
    // same deterministic pass to pick up the next participant without turning
    // this into a distributed scheduler.
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        await this.reconcileForRootTaskPass(rootTaskId, owner, () => {
          materialized += 1;
        });
        return materialized;
      } catch (error) {
        if (
          !(error instanceof TeamExecutionError) ||
          error.code !== 'stale_state' ||
          pass > 0
        )
          throw error;
      }
    }
    return materialized;
  }

  private async reconcileForRootTaskPass(
    rootTaskId: string,
    owner: OwnerScope,
    onMaterialized: () => void,
  ): Promise<void> {
    const team = await this.executions.findTeamRunByRootTaskId(rootTaskId, owner);
    if (!team || team.status !== 'active') return;
    const decision = team.completionRequestedByRunId
      ? await this.executions.findCompletionDecisionForRequest(
          team.id,
          team.completionRequestedByRunId,
          owner,
        )
      : null;
    if (isTeamCompletionApprovalPending(team, decision)) return;

    const [members, attempts, workItems, dependencies] = await Promise.all([
      this.executions.findMembersByTeamRunId(team.id, owner),
      this.executions.findAttemptsByTeamRunId(team.id, owner),
      this.executions.findWorkItemsByTeamRunId(team.id, owner),
      this.executions.findWorkDependenciesByTeamRunId(team.id, owner),
    ]);
    const senderNameById = new Map(members.map((member) => [member.id, member.name]));

    // Direct mailbox messages may target the Team Lead as well as a member.
    // The planner still limits work-attempt wake messages to their assignee;
    // iterating every live participant here lets a member→lead message become
    // a canonical, traceable direct-message Task/Run instead of remaining
    // permanently queued.
    for (const member of members) {
      // Busy delivery is a durable queue, not a second concurrent Turn.
      if (member.status === 'active') continue;
      if (member.status === 'stopped' || member.status === 'failed') continue;
      const queued = await this.messages.listQueuedForMember(team.id, member.id, owner);
      const plan = this.#planner.plan({
        participantId: member.id,
        messages: queued,
        workItems,
        attempts,
        dependencies,
      });
      if (!plan) continue;
      const workItem = plan.workAttempt
        ? workItems.find((item) => item.id === plan.workAttempt!.workItemId) ?? null
        : null;
      try {
        const materialized = await this.#adapter.materialize({
          team,
          member,
          owner,
          plan,
          workItem,
          senderNameById,
        });
        this.logger?.log('info', 'collaboration.activation.materialized', {
          team_run_id: team.id,
          participant_id: member.id,
          task_id: materialized.taskId,
          run_id: materialized.runId,
          cause_count: plan.activation.causes.length,
          priority: plan.activation.priority,
        });
        onMaterialized();
      } catch (error) {
        if (isBenignLostClaim(error)) {
          this.logger?.log('info', 'collaboration.activation.claim_lost', {
            team_run_id: team.id,
            participant_id: member.id,
            dedupe_key: plan.activation.dedupeKey,
          });
          continue;
        }
        throw error;
      }
    }
  }
}

function isBenignLostClaim(error: unknown): error is {
  code: '23505';
  constraint: 'tasks_root_logical_step_key_unique';
} {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === '23505' &&
    candidate.constraint === 'tasks_root_logical_step_key_unique'
  );
}
