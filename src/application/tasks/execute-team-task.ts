import { randomUUID } from 'node:crypto';

import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import { createRun } from '../../domain/runs/run.js';
import {
  createChildTask,
  transitionTask,
  type Task,
} from '../../domain/tasks/task.js';
import type { AgentRuntimePort } from '../ports/agent-runtime.js';
import { RuntimeTimedOutError } from '../ports/agent-runtime.js';
import { buildBootstrapPrompt } from '../context/runtime-prompts.js';
import type { ResolveAgentVersion } from '../agents/resolve-agent-version.js';
import type {
  InvokableOwnerScope,
  InvokableRepository,
} from '../ports/invokable-repository.js';
import type { ClaimedRun, RunRepository } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { AdmissionRepository } from '../ports/admission-repository.js';
import type { DagTeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { RuntimeSessionRepository } from '../ports/runtime-session-repository.js';
import { CollaborativeTeamExecutor } from '../teams/collaborative-team-executor.js';
import { AgenticTeamExecutor } from '../teams/agentic-team-executor.js';
import type {
  TeamExecution,
  TeamNodeExecution,
} from '../../domain/invokables/team-execution.js';
import type { CompiledDagTeamPlan } from '../../domain/invokables/compiled-team-plan.js';
import { CompleteRun } from '../runs/complete-run.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
} from '../runs/runtime-execution-receipt.js';
import {
  decodeRootTaskRunRequestSnapshotRef,
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
  normalizeRootTaskRunRequest,
} from './root-task-input.js';

export interface ExecuteTeamTaskInput {
  readonly claim: ClaimedRun;
  readonly task: Task;
  readonly resolver?: ResolveAgentVersion;
}

export class ExecuteTeamTask {
  public constructor(
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly invokables: InvokableRepository,
    private readonly runtime: AgentRuntimePort,
    private readonly completeRun: CompleteRun,
    private readonly now: () => Date = () => new Date(),
    private readonly admission?: AdmissionRepository,
    private readonly teamExecutions?: DagTeamExecutionRepository,
    private readonly collaborativeExecutor?: CollaborativeTeamExecutor,
    private readonly collaborativeExecutions?: TeamExecutionRepository,
    private readonly runtimeSessions?: RuntimeSessionRepository,
    private readonly agenticExecutor?: AgenticTeamExecutor,
  ) {}

  public async execute(input: ExecuteTeamTaskInput): Promise<Run> {
    const ownerScope = toInvokableOwnerScope(input.task);
    const teamVersion = await this.invokables.findPublishedTeamVersionById(
      input.task.invokableVersionId,
      ownerScope,
    );

    if (teamVersion?.executionMode === 'collaborative_mve') {
      if (
        !this.collaborativeExecutor ||
        !this.collaborativeExecutions ||
        !this.admission
      )
        throw new Error(
          'Collaborative team execution dependencies are unavailable.',
        );
      return this.collaborativeExecutor.activateTeamRun(
        teamVersion,
        input.claim,
        input.task,
        this.invokables,
        this.runs,
        this.runtimeSessions,
        this.tasks,
        this.admission,
      );
    }

    if (teamVersion?.executionMode === 'agentic_mve') {
      if (!this.agenticExecutor)
        throw new Error('Agentic team execution dependencies are unavailable.');
      throw new Error(
        'Agentic team activation requires the durable scheduler.',
      );
    }

    if (!teamVersion?.compiledPlan) {
      throw new Error(
        'Published team version could not be loaded for execution',
      );
    }

    if (teamVersion.compiledPlan.compilerVersion === 'dag-mve-v1') {
      return this.activateDag(input, teamVersion.compiledPlan);
    }

    let stepInput = decodeRootTaskRunRequestSnapshotRef(
      input.task.inputSnapshotRef,
    ).prompt;
    let finalChildRun: Run | null = null;

    for (const step of 'steps' in teamVersion.compiledPlan
      ? teamVersion.compiledPlan.steps
      : []) {
      const resolvedAgentVersion = input.resolver
        ? await input.resolver.resolvePublished(step.agentVersionId, ownerScope)
        : null;
      const loadedAgentVersion = resolvedAgentVersion
        ? resolvedAgentVersion
        : await this.invokables.findPublishedAgentVersionById(
            step.agentVersionId,
            ownerScope,
          );

      if (!loadedAgentVersion) {
        throw new Error(
          `Published agent version ${step.agentVersionId} could not be loaded for team execution`,
        );
      }
      const agentVersion = resolvedAgentVersion ?? {
        ...loadedAgentVersion,
        skills:
          'skills' in loadedAgentVersion &&
          Array.isArray(loadedAgentVersion.skills)
            ? loadedAgentVersion.skills
            : [],
      };
      const toolRefs =
        'toolRefs' in agentVersion && Array.isArray(agentVersion.toolRefs)
          ? agentVersion.toolRefs
          : [];
      if (agentVersion.skills.length > 0 || toolRefs.length > 0)
        throw new Error('Team child runtime extensions are unsupported.');

      const normalizedInput = normalizeRootTaskRunRequest({
        prompt: stepInput,
      });
      const timestamp = this.now();
      const frozenNow = () => timestamp;
      const childTask = createChildTask({
        tenantId: input.task.tenantId,
        workspaceId: input.task.workspaceId,
        principalType: input.task.principalType,
        principalId: input.task.principalId,
        policySnapshotVersion: input.task.policySnapshotVersion,
        rootTaskId: input.task.rootTaskId,
        parentTaskId: input.task.id,
        parentRunId: input.claim.run.id,
        invokableKind: 'agent',
        invokableVersionId: agentVersion.id,
        inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef(normalizedInput),
        inputFingerprint: fingerprintRootTaskRunRequest(normalizedInput),
        logicalStepKey: step.nodeId,
        nodePath: step.nodePath,
        now: frozenNow,
      });
      const childRun = createRun(normalizedInput.prompt, { now: frozenNow });

      await this.tasks.save(childTask);
      await this.runs.save(childRun, { taskId: childTask.id, attempt: 1 });

      const childClaim = await this.runs.claimQueuedById({
        runId: childRun.id,
        workerId: input.claim.workerId,
        activationId: randomUUID(),
        claimedAt: timestamp.toISOString(),
        leaseExpiresAt: input.claim.leaseExpiresAt,
      });

      if (!childClaim) {
        throw new Error(`Child run ${childRun.id} could not be claimed inline`);
      }

      await this.tasks.save(
        transitionTask(
          childTask,
          'active',
          () => new Date(childClaim.run.updatedAt),
        ),
      );

      finalChildRun = await this.executeChildAgentRun(childClaim, {
        systemPrompt: buildBootstrapPrompt(
          agentVersion.instructions,
          agentVersion.skills,
        ),
        turnPrompt: normalizedInput.prompt,
      });

      if (finalChildRun.status !== 'succeeded') {
        return transitionRun(
          input.claim.run,
          finalChildRun.status === 'timed_out' ? 'timed_out' : 'failed',
          finalChildRun.error ? { error: finalChildRun.error } : {},
          this.now,
        );
      }

      stepInput = finalChildRun.result?.text ?? '';
    }

    if (!finalChildRun?.result) {
      throw new Error(
        'Sequential team execution did not produce a final result',
      );
    }

    return transitionRun(
      input.claim.run,
      'succeeded',
      {
        result: { text: finalChildRun.result.text },
        ...(finalChildRun.runtime ? { runtime: finalChildRun.runtime } : {}),
        ...(finalChildRun.usage ? { usage: finalChildRun.usage } : {}),
      },
      this.now,
    );
  }

  private async activateDag(
    input: ExecuteTeamTaskInput,
    plan: CompiledDagTeamPlan,
  ): Promise<Run> {
    if (!this.teamExecutions || !this.admission) {
      throw new Error('DAG execution dependencies are unavailable.');
    }
    const owner = toInvokableOwnerScope(input.task);
    const executionId = randomUUID();
    const timestamp = this.now().toISOString();
    const ready = plan.nodes.filter(
      (node) => node.dependencyNodeIds.length === 0,
    );
    const childRecords = ready.map((node) => {
      const childTask = createChildTask({
        tenantId: input.task.tenantId,
        workspaceId: input.task.workspaceId,
        principalType: input.task.principalType,
        principalId: input.task.principalId,
        policySnapshotVersion: input.task.policySnapshotVersion,
        rootTaskId: input.task.rootTaskId,
        parentTaskId: input.task.id,
        parentRunId: input.claim.run.id,
        invokableKind: 'agent',
        invokableVersionId: node.agentVersionId,
        inputSnapshotRef: input.task.inputSnapshotRef,
        inputFingerprint: input.task.inputFingerprint,
        logicalStepKey: node.nodeId,
        nodePath: node.nodePath,
        now: () => new Date(timestamp),
      });
      return {
        node,
        childTask,
        childRun: createRun(input.claim.run.prompt, {
          now: () => new Date(timestamp),
        }),
      };
    });
    const childByNode = new Map(
      childRecords.map((record) => [record.node.nodeId, record]),
    );
    const nodes: TeamNodeExecution[] = plan.nodes.map((node) => {
      const child = childByNode.get(node.nodeId);
      return {
        id: randomUUID(),
        teamExecutionId: executionId,
        nodeId: node.nodeId,
        dependencyNodeIds: node.dependencyNodeIds,
        childTaskId: child?.childTask.id ?? null,
        childRunId: child?.childRun.id ?? null,
        status: child ? 'queued' : 'pending',
        result: null,
        failureDetail: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });
    const execution: TeamExecution = {
      id: executionId,
      ...owner,
      rootTaskId: input.task.rootTaskId,
      rootRunId: input.claim.run.id,
      teamVersionId: plan.teamVersionId,
      environmentVersionId: plan.environmentVersionId,
      status: 'waiting_children',
      result: null,
      failureDetail: null,
      nodes,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.admission.withTransaction(async (transaction) => {
      for (const child of childRecords) {
        await transaction.tasks.save(child.childTask);
        await transaction.runs.save(child.childRun, {
          taskId: child.childTask.id,
          attempt: 1,
        });
      }
    });
    await this.teamExecutions.create(execution);
    if (!this.runs.releaseClaimedToWaiting) {
      throw new Error('Waiting Run persistence is unavailable.');
    }
    const waiting = await this.runs.releaseClaimedToWaiting(input.claim);
    await this.admission.withTransaction(async (transaction) => {
      for (const child of childRecords) {
        await transaction.enqueueRunDispatch(child.childRun.id, timestamp);
      }
    });
    return waiting;
  }

  private async executeChildAgentRun(
    claim: ClaimedRun,
    input: { readonly systemPrompt: string; readonly turnPrompt: string },
  ): Promise<Run> {
    try {
      const execution = await this.runtime.execute({
        operation: 'create',
        runId: claim.run.id,
        prompt: input.turnPrompt,
        systemPrompt: input.systemPrompt,
      });
      const succeeded = transitionRun(
        claim.run,
        'succeeded',
        {
          runtime: {
            provider: execution.provider,
            model: execution.model,
          },
          result: { text: execution.text },
          ...(execution.usage ? { usage: execution.usage } : {}),
        },
        this.now,
      );

      try {
        return await this.completeRun.execute({ claim, run: succeeded });
      } catch {
        throw new RunCompletionPersistenceError(
          createRuntimeExecutionReceipt(succeeded, claim.taskId),
        );
      }
    } catch (error) {
      if (error instanceof RunCompletionPersistenceError) {
        throw error;
      }
      const failure: RunFailure =
        error instanceof RuntimeTimedOutError
          ? {
              code: 'runtime_timed_out',
              message: 'The runtime exceeded the configured timeout.',
            }
          : {
              code: 'runtime_execution_failed',
              message: 'The runtime could not complete the run.',
            };
      const failed = transitionRun(
        claim.run,
        error instanceof RuntimeTimedOutError ? 'timed_out' : 'failed',
        { error: failure },
        this.now,
      );

      try {
        return await this.completeRun.execute({ claim, run: failed });
      } catch {
        throw new RunCompletionPersistenceError(
          createRuntimeExecutionReceipt(failed, claim.taskId),
        );
      }
    }
  }
}

function toInvokableOwnerScope(task: Task): InvokableOwnerScope {
  return {
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    principalType: task.principalType,
    principalId: task.principalId,
  };
}
