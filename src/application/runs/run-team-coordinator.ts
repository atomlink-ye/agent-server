import type { Task } from '../../domain/tasks/task.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { CollaborationActivationReconciler } from '../collaboration/collaboration-activation-reconciler.js';
import type { InvokableOwnerScope } from '../ports/invokable-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';

export interface RunTeamContext {
  readonly member: TeamMemberRun;
  readonly team: TeamRun;
  readonly owner: InvokableOwnerScope;
}

/** Owns the process-local participant turn lane and durable member status. */
export class RunTeamCoordinator {
  private readonly memberMutexes = new Map<
    string,
    { tail: Promise<void>; queued: number }
  >();

  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    private readonly activationReconciler?: Pick<
      CollaborationActivationReconciler,
      'reconcileForRootTask'
    >,
  ) {}

  public async runExclusive<T>(
    teamMemberRunId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(teamMemberRunId);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  public async resolve(task: Task): Promise<RunTeamContext | null> {
    if (
      ['lead_turn', 'work_attempt', 'direct_message'].includes(
        task.teamTaskKind ?? '',
      ) &&
      !task.teamMemberRunId
    )
      throw new Error('Team task is missing member identity.');
    if (!task.teamMemberRunId) return null;

    const owner: InvokableOwnerScope = {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
    };
    const [member, team] = await Promise.all([
      this.executions.findMemberRunById(task.teamMemberRunId, owner),
      this.executions.findTeamRunByRootTaskId(task.rootTaskId, owner),
    ]);
    if (
      !team ||
      !member ||
      member.teamRunId !== team.id ||
      !['lead_turn', 'work_attempt', 'direct_message'].includes(
        task.teamTaskKind ?? '',
      ) ||
      (task.teamTaskKind === 'lead_turn' && member.role !== 'lead') ||
      (task.teamTaskKind === 'work_attempt' && member.role !== 'member') ||
      member.workerVersionId !== task.invokableVersionId
    )
      throw new Error('Team member task identity is invalid.');
    return { member, team, owner };
  }

  public async markActive(context: RunTeamContext): Promise<void> {
    await this.executions.updateMemberRunStatus(
      context.member.id,
      'active',
      undefined,
      context.owner,
    );
  }

  public async updateTerminal(input: {
    readonly claimTaskId: string;
    readonly task: Task;
    readonly context: RunTeamContext;
    readonly fallbackStatus: 'idle' | 'failed';
  }): Promise<void> {
    const status = await this.resolveTerminalStatus(input).catch(
      () => input.fallbackStatus,
    );
    await this.executions.updateMemberRunStatus(
      input.context.member.id,
      status,
      undefined,
      input.context.owner,
    );
  }

  public async updateTerminalBestEffort(input: {
    readonly claimTaskId: string;
    readonly task: Task | null | undefined;
    readonly context: RunTeamContext | null;
    readonly fallbackStatus: 'idle' | 'failed';
  }): Promise<void> {
    if (!input.task || !input.context) return;
    await this.updateTerminal({
      claimTaskId: input.claimTaskId,
      task: input.task,
      context: input.context,
      fallbackStatus: input.fallbackStatus,
    }).catch(() => undefined);
  }

  public async reconcile(context: RunTeamContext): Promise<void> {
    if (!this.activationReconciler) return;
    const member = await this.executions.findMemberRunById(
      context.member.id,
      context.owner,
    );
    if (!member) return;
    const team = await this.executions.findTeamRunById(
      member.teamRunId,
      context.owner,
    );
    if (!team) return;
    await this.activationReconciler.reconcileForRootTask(
      team.rootTaskId,
      context.owner,
    );
  }

  private async resolveTerminalStatus(input: {
    readonly claimTaskId: string;
    readonly task: Task;
    readonly context: RunTeamContext;
    readonly fallbackStatus: 'idle' | 'failed';
  }): Promise<'idle' | 'failed'> {
    const { task, context } = input;
    if (
      task.teamTaskKind !== 'work_attempt' ||
      task.teamMemberRunId !== context.member.id
    )
      return input.fallbackStatus;
    const team = await this.executions.findTeamRunByRootTaskId(
      task.rootTaskId,
      context.owner,
    );
    if (!team) return input.fallbackStatus;
    const attempts = await this.executions.findAttemptsByTeamRunId(
      team.id,
      context.owner,
    );
    return attempts.some(
      (attempt) =>
        attempt.executionTaskId === input.claimTaskId &&
        attempt.assigneeMemberId === context.member.id &&
        attempt.status === 'completed',
    )
      ? 'idle'
      : input.fallbackStatus;
  }

  private async acquire(teamMemberRunId: string): Promise<() => void> {
    let entry = this.memberMutexes.get(teamMemberRunId);
    if (!entry) {
      entry = { tail: Promise.resolve(), queued: 0 };
      this.memberMutexes.set(teamMemberRunId, entry);
    }
    const prior = entry.tail;
    let releaseWaiter!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseWaiter = resolve;
    });
    entry.tail = current;
    entry.queued += 1;
    await prior;
    entry.queued -= 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseWaiter();
      if (entry && entry.tail === current && entry.queued === 0)
        this.memberMutexes.delete(teamMemberRunId);
    };
  }
}
