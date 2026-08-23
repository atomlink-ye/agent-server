import { transitionRun } from '../../domain/runs/run.js';
import type { Task } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import type { ClaimedRun } from '../ports/run-repository.js';
import type { ExecutionTurnOutcome } from '../ports/execution-runtime.js';
import {
  createRuntimeExecutionReceipt,
  RuntimeMemoryPersistenceError,
} from './runtime-execution-receipt.js';

/**
 * Converts safe runtime memory candidates into durable Memory Proposals. It is
 * intentionally downstream of the Execution Plane: runtimes surface
 * candidates, while Agent Server owns eligibility, provenance and persistence.
 */
export class RuntimeMemoryProposalWriter {
  public constructor(
    private readonly createMemoryProposal: CreateMemoryProposal | undefined,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async write(input: {
    readonly claim: ClaimedRun;
    readonly task: Task;
    readonly agentVersionId: string;
    readonly proposalLimit: number;
    readonly execution: ExecutionTurnOutcome;
  }): Promise<void> {
    const candidateInputs = (
      input.task.sourceMessageId ? (input.execution.memoryCandidates ?? []) : []
    )
      .slice(0, input.proposalLimit)
      .flatMap((candidate, sourceCandidateIndex) => {
        if (!isSafeRuntimeCandidate(candidate)) return [];
        return [
          {
            content: candidate.content,
            category: candidate.category,
            sourceTaskId: input.task.id,
            ...(input.task.sessionId
              ? { sourceSessionId: input.task.sessionId }
              : {}),
            ...(input.task.sourceMessageId
              ? { sourceMessageId: input.task.sourceMessageId }
              : {}),
            sourceRunId: input.claim.run.id,
            sourceAgentVersionId: input.agentVersionId,
            sourceCandidateIndex,
            accessContext: {
              tenantId: input.task.tenantId,
              serviceAccountId: input.task.principalId,
              workspaceId: input.task.workspaceId,
              principalType: input.task.principalType as 'service_account',
              principalId: input.task.principalId,
              policySnapshotVersion: input.task.policySnapshotVersion,
            },
          },
        ];
      });

    try {
      if (candidateInputs.length && this.createMemoryProposal) {
        if (this.createMemoryProposal.executeBatch) {
          await this.createMemoryProposal.executeBatch(candidateInputs);
        } else {
          for (const candidate of candidateInputs)
            await this.createMemoryProposal.execute(candidate);
        }
      }
    } catch (error) {
      const receipt = createRuntimeExecutionReceipt(
        transitionRun(
          input.claim.run,
          'succeeded',
          {
            runtime: {
              provider: input.execution.provider,
              model: input.execution.model,
            },
            result: { text: input.execution.text },
            ...(input.execution.usage ? { usage: input.execution.usage } : {}),
          },
          this.now,
        ),
        input.claim.taskId,
      );
      this.logger.log('error', 'run.memory_persistence_failed', {
        run_id: input.claim.run.id,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new RuntimeMemoryPersistenceError(receipt);
    }
  }
}

function isSafeRuntimeCandidate(candidate: {
  readonly category: string;
  readonly content: string;
}): boolean {
  return (
    [
      'terminology',
      'output_preference',
      'project_constraint',
      'confirmed_workflow_procedure',
    ].includes(candidate.category) &&
    candidate.content.length <= 4096 &&
    !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_ -]?key|secret|token|password)\s*[:=]|\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i.test(
      candidate.content,
    )
  );
}
