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
    if (input.sourceTaskId) {
      const task = await this.taskRepository.findByIdForOwner(
        input.sourceTaskId,
        ownerScopeFromAccessContext(input.accessContext),
      );
      if (!task) {
        throw new SourceTaskNotFoundError();
      }
      workspaceId = task.task.workspaceId;
    }

    const proposal = createMemoryProposal({
      ...ownerScopeFromAccessContext(input.accessContext, workspaceId),
      originalContent: input.content,
      originalCategory: input.category,
      sourceTaskId: input.sourceTaskId ?? null,
      sourceSessionId: input.sourceSessionId ?? null,
      proposerSnapshot: {
        principalType: input.accessContext.principalType,
        principalId: input.accessContext.principalId,
        policySnapshotVersion: input.accessContext.policySnapshotVersion,
      },
      ...(input.now ? { now: input.now } : {}),
    });

    return this.memoryRepository.createProposal(proposal);
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
