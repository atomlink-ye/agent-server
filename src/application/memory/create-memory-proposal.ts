import type { ServiceAccountAccessContext } from '../../domain/access-context.js';
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

export class InvalidMemoryProvenanceError extends Error {
  public readonly code = 'invalid_memory_provenance';
  public constructor() {
    super(
      'Runtime memory provenance must contain a matching task, message, run, agent version, and candidate index.',
    );
    this.name = 'InvalidMemoryProvenanceError';
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
    assertProvenanceShape(input);
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
      await validateRuntimeProvenance(input, task, this.taskRepository);
      workspaceId = task.task.workspaceId;
      sourceMessageId = input.sourceRunId
        ? (task.task.sourceMessageId ?? sourceMessageId)
        : sourceMessageId;
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
      assertProvenanceShape(input);
      let workspaceId = input.accessContext.workspaceId;
      let sourceMessageId = input.sourceMessageId ?? null;
      if (input.sourceTaskId) {
        const task = await this.taskRepository.findByIdForOwner(
          input.sourceTaskId,
          ownerScopeFromAccessContext(input.accessContext),
        );
        if (!task) throw new SourceTaskNotFoundError();
        await validateRuntimeProvenance(input, task, this.taskRepository);
        workspaceId = task.task.workspaceId;
        sourceMessageId = input.sourceRunId
          ? (task.task.sourceMessageId ?? sourceMessageId)
          : sourceMessageId;
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

function assertProvenanceShape(input: CreateMemoryProposalInput): void {
  const runtimeFields = [
    input.sourceTaskId,
    input.sourceMessageId,
    input.sourceRunId,
    input.sourceAgentVersionId,
    input.sourceCandidateIndex,
  ];
  const present = [
    input.sourceMessageId,
    input.sourceRunId,
    input.sourceAgentVersionId,
    input.sourceCandidateIndex,
  ].some((value) => value !== undefined && value !== null);
  if (!present) return;
  const complete = runtimeFields.every(
    (value) => value !== undefined && value !== null,
  );
  if (present !== complete) throw new InvalidMemoryProvenanceError();
  if (complete && input.sourceCandidateIndex! < 0)
    throw new InvalidMemoryProvenanceError();
}

async function validateRuntimeProvenance(
  input: CreateMemoryProposalInput,
  record: Awaited<ReturnType<TaskRepository['findByIdForOwner']>>,
  tasks: TaskRepository,
): Promise<void> {
  if (input.sourceRunId === undefined || input.sourceRunId === null) return;
  if (!record) throw new InvalidMemoryProvenanceError();
  const latestRun = record.latestRun;
  if (
    !latestRun ||
    latestRun.runId !== input.sourceRunId ||
    record.task.invokableVersionId !== input.sourceAgentVersionId ||
    (record.task.sourceMessageId ?? null) !== (input.sourceMessageId ?? null) ||
    record.task.workspaceId.length === 0
  )
    throw new InvalidMemoryProvenanceError();
  const reloaded = await tasks.findByIdForOwner(input.sourceTaskId!, {
    tenantId: input.accessContext.tenantId,
    workspaceId: input.accessContext.workspaceId,
    principalType: input.accessContext.principalType,
    principalId: input.accessContext.principalId,
  });
  if (!reloaded || reloaded.task.id !== input.sourceTaskId)
    throw new InvalidMemoryProvenanceError();
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
