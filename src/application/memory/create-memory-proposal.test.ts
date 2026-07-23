import { describe, expect, it } from 'vitest';

import type { ServiceAccountAccessContext } from '../control-plane/access-context.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { WorkspaceMemoryRepository } from '../ports/workspace-memory-repository.js';
import {
  CreateMemoryProposal,
  InvalidMemoryProvenanceError,
  SourceTaskNotFoundError,
} from './create-memory-proposal.js';

const accessContext: ServiceAccountAccessContext = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account',
  principalId: 'svc_enabled',
  serviceAccountId: 'svc_enabled',
  policySnapshotVersion: 'policy-2026-07-22',
};

describe('CreateMemoryProposal', () => {
  it('persists a pending proposal with server-derived owner and proposer snapshot', async () => {
    const memoryRepository = new FakeWorkspaceMemoryRepository();
    const service = new CreateMemoryProposal(
      memoryRepository,
      new FakeTaskRepository(),
    );

    const proposal = await service.execute({
      content: 'Remember the deployment checklist.',
      category: 'ops',
      accessContext,
      sourceSessionId: 'session-1',
    });

    expect(proposal).toMatchObject({
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      principalType: 'service_account',
      principalId: 'svc_enabled',
      originalContent: 'Remember the deployment checklist.',
      originalCategory: 'ops',
      sourceTaskId: null,
      sourceSessionId: 'session-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'svc_enabled',
        policySnapshotVersion: 'policy-2026-07-22',
      },
      status: 'pending',
    });
    expect(memoryRepository.proposals).toHaveLength(1);
  });

  it('rejects a source task outside the authenticated owner scope', async () => {
    const service = new CreateMemoryProposal(
      new FakeWorkspaceMemoryRepository(),
      new FakeTaskRepository(),
    );

    await expect(
      service.execute({
        content: 'Remember inaccessible task context.',
        category: 'task',
        sourceTaskId: '00000000-0000-4000-8000-000000000404',
        accessContext,
      }),
    ).rejects.toBeInstanceOf(SourceTaskNotFoundError);
  });

  it('rejects every partial runtime provenance shape before persistence', async () => {
    const service = new CreateMemoryProposal(
      new FakeWorkspaceMemoryRepository(),
      new FakeTaskRepository(),
    );
    const partials = [
      { sourceRunId: 'run' },
      { sourceTaskId: 'task', sourceRunId: 'run' },
      { sourceRunId: 'run', sourceAgentVersionId: 'version' },
      { sourceRunId: 'run', sourceCandidateIndex: 0 },
    ];
    for (const provenance of partials) {
      await expect(
        service.execute({
          content: 'runtime memory',
          category: 'project_constraint',
          accessContext,
          ...provenance,
        }),
      ).rejects.toBeInstanceOf(InvalidMemoryProvenanceError);
    }
  });
});

class FakeWorkspaceMemoryRepository implements WorkspaceMemoryRepository {
  public readonly proposals: Parameters<
    WorkspaceMemoryRepository['createProposal']
  >[0][] = [];

  public async createProposal(
    proposal: Parameters<WorkspaceMemoryRepository['createProposal']>[0],
  ) {
    this.proposals.push(proposal);
    return proposal;
  }

  public async findProposalByIdForOwner() {
    return null;
  }

  public async listProposalsByOwnerScope() {
    return this.proposals;
  }

  public async reviewProposal(): Promise<never> {
    throw new Error('not implemented');
  }

  public async listAcceptedEntriesByOwnerScope() {
    return [];
  }
}

class FakeTaskRepository implements TaskRepository {
  public async save(): Promise<void> {}

  public async findById() {
    return null;
  }

  public async findByIdForOwner() {
    return null;
  }

  public async findByRootTaskIdForOwner() {
    return [];
  }
}
