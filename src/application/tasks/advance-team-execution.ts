import { createChildTask, transitionTask } from '../../domain/tasks/task.js';
import { createRun } from '../../domain/runs/run.js';
import type {
  CompleteClaimedRunOptions,
  RunRepository,
} from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import { buildTeamHandoff, MAX_CHILD_RESULT_BYTES } from './team-handoff.js';
import {
  decodeRootTaskRunRequestSnapshotRef,
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

export class AdvanceTeamExecution {
  public constructor(
    private readonly executions: TeamExecutionRepository,
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly invokables: InvokableRepository,
    private readonly admission: AdmissionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async finalizeFailure(
    execution: Awaited<ReturnType<TeamExecutionRepository['recordNodeResult']>>,
    owner: {
      tenantId: string;
      workspaceId: string;
      principalType: string;
      principalId: string;
    },
    failureDetail: string,
  ): Promise<void> {
    for (const pending of execution.nodes.filter(
      (candidate) => candidate.status === 'pending',
    )) {
      await this.executions.recordNodeResult({
        ...owner,
        teamExecutionId: execution.id,
        nodeId: pending.nodeId,
        status: 'blocked',
        failureDetail,
      });
    }
    await this.executions.setStatus(
      execution.id,
      owner,
      'failed',
      null,
      failureDetail,
    );
    await this.runs.finalizeWaiting?.({
      runId: execution.rootRunId,
      status: 'failed',
      error: {
        code: 'runtime_execution_failed',
        message: 'Team execution failed.',
      },
      updatedAt: this.now().toISOString(),
    });
    const root = await this.tasks.findById(execution.rootTaskId);
    if (root && root.status !== 'failed' && root.status !== 'completed')
      await this.tasks.save(transitionTask(root, 'failed', this.now));
  }

  public async execute(input: CompleteClaimedRunOptions): Promise<void> {
    const childTask = await this.tasks.findById(input.claim.taskId);
    if (!childTask || childTask.depth === 0) return;
    const owner = {
      tenantId: childTask.tenantId,
      workspaceId: childTask.workspaceId,
      principalType: childTask.principalType,
      principalId: childTask.principalId,
    };
    const execution = await this.executions.findByChildTaskId(
      childTask.id,
      owner,
    );
    if (!execution) return;
    const node = execution.nodes.find(
      (candidate) => candidate.childTaskId === childTask.id,
    );
    if (!node) return;
    const terminalStatus =
      input.run.status === 'succeeded' ? 'succeeded' : 'failed';
    const childResult = input.run.result?.text ?? null;
    if (
      terminalStatus === 'succeeded' &&
      childResult !== null &&
      Buffer.byteLength(childResult, 'utf8') > MAX_CHILD_RESULT_BYTES
    ) {
      const failed = await this.executions.recordNodeResult({
        ...owner,
        teamExecutionId: execution.id,
        nodeId: node.nodeId,
        status: 'failed',
        childTaskId: childTask.id,
        childRunId: input.run.id,
        result: null,
        failureDetail: 'A team child result exceeded the bounded result limit.',
      });
      await this.finalizeFailure(
        failed,
        owner,
        'A team child result exceeded the bounded result limit.',
      );
      return;
    }
    const updated = await this.executions.recordNodeResult({
      ...owner,
      teamExecutionId: execution.id,
      nodeId: node.nodeId,
      status: terminalStatus,
      childTaskId: childTask.id,
      childRunId: input.run.id,
      result: childResult,
      failureDetail: input.run.error?.message ?? null,
    });
    if (terminalStatus === 'failed') {
      await this.finalizeFailure(updated, owner, 'A team child failed.');
      return;
    }
    const team = await this.invokables.findPublishedTeamVersionById(
      updated.teamVersionId,
      owner,
    );
    const plan = team?.compiledPlan;
    if (!plan || plan.compilerVersion !== 'dag-mve-v1') return;
    if (node.nodeId === plan.finalOutputNodeId) {
      await this.executions.setStatus(
        updated.id,
        owner,
        'succeeded',
        input.run.result?.text ?? null,
      );
      await this.runs.finalizeWaiting?.({
        runId: updated.rootRunId,
        status: 'succeeded',
        result: input.run.result ?? { text: '' },
        updatedAt: this.now().toISOString(),
      });
      const root = await this.tasks.findById(updated.rootTaskId);
      if (root && root.status !== 'completed')
        await this.tasks.save(transitionTask(root, 'completed', this.now));
      return;
    }
    const successful = new Map(
      updated.nodes
        .filter((candidate) => candidate.status === 'succeeded')
        .map((candidate) => [candidate.nodeId, candidate]),
    );
    const eligible = plan.nodes.filter(
      (candidate) =>
        !updated.nodes.find(
          (nodeState) => nodeState.nodeId === candidate.nodeId,
        )?.childTaskId &&
        candidate.dependencyNodeIds.every((dependency) =>
          successful.has(dependency),
        ),
    );
    if (eligible.length === 0) return;
    const root = await this.tasks.findById(updated.rootTaskId);
    if (!root) throw new Error('Team root task could not be loaded.');
    const rootBrief = decodeRootTaskRunRequestSnapshotRef(
      root.inputSnapshotRef,
    ).prompt;
    const sources = [...successful.values()].map((source) => ({
      nodeId: source.nodeId,
      taskId: source.childTaskId!,
      runId: source.childRunId!,
      result: source.result ?? '',
    }));
    let handoff: string;
    try {
      handoff =
        eligible.length === 1 && eligible[0]!.output === 'final'
          ? buildTeamHandoff({ rootBrief, sources })
          : rootBrief;
    } catch {
      await this.finalizeFailure(
        updated,
        owner,
        'A team handoff exceeded the bounded handoff limit.',
      );
      return;
    }
    const records = eligible.map((node) => {
      const normalized = normalizeRootTaskRunRequest({ prompt: handoff });
      const childTask = createChildTask({
        tenantId: root.tenantId,
        workspaceId: root.workspaceId,
        principalType: root.principalType,
        principalId: root.principalId,
        policySnapshotVersion: root.policySnapshotVersion,
        rootTaskId: root.rootTaskId,
        parentTaskId: root.id,
        parentRunId: updated.rootRunId,
        invokableKind: 'agent',
        invokableVersionId: node.agentVersionId,
        inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef(normalized),
        inputFingerprint: fingerprintRootTaskRunRequest(normalized),
        logicalStepKey: node.nodeId,
        nodePath: node.nodePath,
        now: this.now,
      });
      return {
        node,
        childTask,
        childRun: createRun(handoff, { now: this.now }),
      };
    });
    await this.admission.withTransaction(async (transaction) => {
      for (const record of records) {
        await transaction.tasks.save(record.childTask);
        await transaction.runs.save(record.childRun, {
          taskId: record.childTask.id,
          attempt: 1,
        });
        await transaction.enqueueRunDispatch(
          record.childRun.id,
          record.childRun.createdAt,
        );
      }
    });
    for (const record of records)
      await this.executions.recordNodeResult({
        ...owner,
        teamExecutionId: updated.id,
        nodeId: record.node.nodeId,
        status: 'queued',
        childTaskId: record.childTask.id,
        childRunId: record.childRun.id,
      });
  }
}
