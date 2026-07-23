import type { ServiceAccountAccessContext } from '../control-plane/access-context.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { WorkspaceMemoryRepository } from '../ports/workspace-memory-repository.js';
import {
  createMemoryProposal,
  type MemoryProposal,
} from '../../domain/workspace-memory/memory-proposal.js';

export interface CreateMemoryProposalInput {
  readonly content: string;
  readonly category: string;
  readonly sourceTaskId?: string | null;
  readonly sourceSessionId?: string | null;
  readonly sourceMessageId?: string | null;
  readonly sourceRunId?: string | null;
  readonly sourceAgentVersionId?: string | null;
  readonly sourceCandidateIndex?: number | null;
  readonly accessContext: ServiceAccountAccessContext;
  readonly now?: () => Date;
}

export class SourceTaskNotFoundError extends Error {
  public readonly code = 'task_not_found';

  public constructor() {
    super('The requested source task does not exist.');
    this.name = 'SourceTaskNotFoundError';
  }
}

export class CreateMemoryProposal {
  public constructor(
    private readonly memoryRepository: WorkspaceMemoryRepository,
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(
    input: CreateMemoryProposalInput,
  ): Promise<MemoryProposal> {
    let workspaceId = input.accessContext.workspaceId;
    let sourceMessageId = input.sourceMessageId ?? null;
    if (input.sourceTaskId) {
      const task = await this.taskRepository.findByIdForOwner(
        input.sourceTaskId,
        ownerScopeFromAccessContext(input.accessContext),
      );
      if (!task) {
        throw new SourceTaskNotFoundError();
      }
      workspaceId = task.task.workspaceId;
      sourceMessageId = task.task.sourceMessageId ?? sourceMessageId;
    }

    const proposal = createMemoryProposal({
      ...ownerScopeFromAccessContext(input.accessContext, workspaceId),
      originalContent: input.content,
      originalCategory: input.category,
      sourceTaskId: input.sourceTaskId ?? null,
      sourceSessionId: input.sourceSessionId ?? null,
      sourceMessageId,
      sourceRunId: input.sourceRunId ?? null,
      sourceAgentVersionId: input.sourceAgentVersionId ?? null,
      sourceCandidateIndex: input.sourceCandidateIndex ?? null,
      proposerSnapshot: {
        principalType: input.accessContext.principalType,
        principalId: input.accessContext.principalId,
        policySnapshotVersion: input.accessContext.policySnapshotVersion,
      },
      ...(input.now ? { now: input.now } : {}),
    });

    return this.memoryRepository.createProposal(proposal);
  }

  public async executeBatch(
    inputs: readonly CreateMemoryProposalInput[],
  ): Promise<readonly MemoryProposal[]> {
    const proposals: MemoryProposal[] = [];
    for (const input of inputs) {
      let workspaceId = input.accessContext.workspaceId;
      let sourceMessageId = input.sourceMessageId ?? null;
      if (input.sourceTaskId) {
        const task = await this.taskRepository.findByIdForOwner(
          input.sourceTaskId,
          ownerScopeFromAccessContext(input.accessContext),
        );
        if (!task) throw new SourceTaskNotFoundError();
        workspaceId = task.task.workspaceId;
        sourceMessageId = task.task.sourceMessageId ?? sourceMessageId;
      }
      proposals.push(
        createMemoryProposal({
          ...ownerScopeFromAccessContext(input.accessContext, workspaceId),
          originalContent: input.content,
          originalCategory: input.category,
          sourceTaskId: input.sourceTaskId ?? null,
          sourceSessionId: input.sourceSessionId ?? null,
          sourceMessageId,
          sourceRunId: input.sourceRunId ?? null,
          sourceAgentVersionId: input.sourceAgentVersionId ?? null,
          sourceCandidateIndex: input.sourceCandidateIndex ?? null,
          proposerSnapshot: {
            principalType: input.accessContext.principalType,
            principalId: input.accessContext.principalId,
            policySnapshotVersion: input.accessContext.policySnapshotVersion,
          },
          ...(input.now ? { now: input.now } : {}),
        }),
      );
    }
    if (this.memoryRepository.createProposalsBatch) {
      return this.memoryRepository.createProposalsBatch(proposals);
    }
    const result: MemoryProposal[] = [];
    for (const proposal of proposals)
      result.push(await this.memoryRepository.createProposal(proposal));
    return result;
  }
}

function ownerScopeFromAccessContext(
  accessContext: ServiceAccountAccessContext,
  workspaceId = accessContext.workspaceId,
) {
  return {
    tenantId: accessContext.tenantId,
    workspaceId,
    principalType: accessContext.principalType,
    principalId: accessContext.principalId,
  };
}
