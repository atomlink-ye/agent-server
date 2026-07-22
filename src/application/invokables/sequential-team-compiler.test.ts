import { describe, expect, it } from 'vitest';

import {
  createDraftAgentVersion,
  publishAgentVersion,
} from '../../domain/invokables/agent-version.js';
import { createDraftTeamVersion } from '../../domain/invokables/team-version.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import {
  InvalidTeamGraphError,
  SequentialTeamCompiler,
} from './sequential-team-compiler.js';

const ownerScope = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
};

describe('SequentialTeamCompiler', () => {
  it('compiles a published-agent-only linear team into a stable execution plan', async () => {
    const repository = new InMemoryInvokableRepository([
      publishAgentVersion(
        createDraftAgentVersion({
          id: '00000000-0000-4000-8000-000000001001',
          definitionId: '00000000-0000-4000-8000-000000000011',
          ...ownerScope,
          name: 'Collector',
          instructions: 'Collect evidence.',
          now: () => new Date('2026-07-22T11:00:00.000Z'),
        }),
        () => new Date('2026-07-22T11:10:00.000Z'),
      ),
      publishAgentVersion(
        createDraftAgentVersion({
          id: '00000000-0000-4000-8000-000000001002',
          definitionId: '00000000-0000-4000-8000-000000000012',
          ...ownerScope,
          name: 'Analyst',
          instructions: 'Analyze evidence.',
          now: () => new Date('2026-07-22T11:00:00.000Z'),
        }),
        () => new Date('2026-07-22T11:10:00.000Z'),
      ),
      publishAgentVersion(
        createDraftAgentVersion({
          id: '00000000-0000-4000-8000-000000001003',
          definitionId: '00000000-0000-4000-8000-000000000013',
          ...ownerScope,
          name: 'Summarizer',
          instructions: 'Summarize the final result.',
          now: () => new Date('2026-07-22T11:00:00.000Z'),
        }),
        () => new Date('2026-07-22T11:10:00.000Z'),
      ),
    ]);
    const teamVersion = createDraftTeamVersion({
      id: '00000000-0000-4000-8000-000000000301',
      definitionId: '00000000-0000-4000-8000-000000000021',
      ...ownerScope,
      name: 'Research Team',
      graph: {
        nodes: [
          {
            id: 'collect',
            kind: 'invoke',
            agentVersionId: '00000000-0000-4000-8000-000000001001',
            successNodeId: 'analyze',
            output: 'step',
          },
          {
            id: 'analyze',
            kind: 'invoke',
            agentVersionId: '00000000-0000-4000-8000-000000001002',
            successNodeId: 'summarize',
            output: 'step',
          },
          {
            id: 'summarize',
            kind: 'invoke',
            agentVersionId: '00000000-0000-4000-8000-000000001003',
            successNodeId: null,
            output: 'final',
          },
        ],
      },
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });

    const compiled = await new SequentialTeamCompiler(repository).compile(
      teamVersion,
    );

    expect(compiled.compilerVersion).toBe('sequential-mvp-v1');
    expect(compiled.entryNodeId).toBe('collect');
    expect(compiled.finalOutputNodeId).toBe('summarize');
    expect(compiled.steps).toEqual([
      {
        nodeId: 'collect',
        nodePath: 'step.0001',
        agentVersionId: '00000000-0000-4000-8000-000000001001',
        order: 1,
        output: 'step',
      },
      {
        nodeId: 'analyze',
        nodePath: 'step.0002',
        agentVersionId: '00000000-0000-4000-8000-000000001002',
        order: 2,
        output: 'step',
      },
      {
        nodeId: 'summarize',
        nodePath: 'step.0003',
        agentVersionId: '00000000-0000-4000-8000-000000001003',
        order: 3,
        output: 'final',
      },
    ]);
  });

  it('rejects team nodes that do not resolve to published agent versions in the same owner scope', async () => {
    const repository = new InMemoryInvokableRepository([
      publishAgentVersion(
        createDraftAgentVersion({
          id: '00000000-0000-4000-8000-000000001101',
          definitionId: '00000000-0000-4000-8000-000000000111',
          tenantId: ownerScope.tenantId,
          workspaceId: ownerScope.workspaceId,
          principalType: ownerScope.principalType,
          principalId: 'svc_other',
          name: 'Foreign Agent',
          instructions: 'Not from the right owner scope.',
          now: () => new Date('2026-07-22T11:00:00.000Z'),
        }),
        () => new Date('2026-07-22T11:10:00.000Z'),
      ),
    ]);
    const teamVersion = createDraftTeamVersion({
      id: '00000000-0000-4000-8000-000000000302',
      definitionId: '00000000-0000-4000-8000-000000000022',
      ...ownerScope,
      name: 'Cross Tenant Team',
      graph: {
        nodes: [
          {
            id: 'collect',
            kind: 'invoke',
            agentVersionId: '00000000-0000-4000-8000-000000001101',
            successNodeId: null,
            output: 'final',
          },
        ],
      },
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });

    await expect(
      new SequentialTeamCompiler(repository).compile(teamVersion),
    ).rejects.toBeInstanceOf(InvalidTeamGraphError);
  });

  it('rejects non-sequential graphs with loops or fan-in', async () => {
    const repository = new InMemoryInvokableRepository([
      publishAgentVersion(
        createDraftAgentVersion({
          id: '00000000-0000-4000-8000-000000001201',
          definitionId: '00000000-0000-4000-8000-000000000121',
          ...ownerScope,
          name: 'Reusable Agent',
          instructions: 'Do one step.',
          now: () => new Date('2026-07-22T11:00:00.000Z'),
        }),
        () => new Date('2026-07-22T11:10:00.000Z'),
      ),
    ]);
    const teamVersion = createDraftTeamVersion({
      id: '00000000-0000-4000-8000-000000000303',
      definitionId: '00000000-0000-4000-8000-000000000023',
      ...ownerScope,
      name: 'Loop Team',
      graph: {
        nodes: [
          {
            id: 'collect',
            kind: 'invoke',
            agentVersionId: '00000000-0000-4000-8000-000000001201',
            successNodeId: 'analyze',
            output: 'step',
          },
          {
            id: 'analyze',
            kind: 'invoke',
            agentVersionId: '00000000-0000-4000-8000-000000001201',
            successNodeId: 'collect',
            output: 'final',
          },
        ],
      },
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });

    await expect(
      new SequentialTeamCompiler(repository).compile(teamVersion),
    ).rejects.toBeInstanceOf(InvalidTeamGraphError);
  });
});

class InMemoryInvokableRepository implements InvokableRepository {
  readonly #publishedAgentVersions = new Map<
    string,
    ReturnType<typeof publishAgentVersion>
  >();

  public constructor(
    agentVersions: ReadonlyArray<ReturnType<typeof publishAgentVersion>>,
  ) {
    for (const agentVersion of agentVersions) {
      this.#publishedAgentVersions.set(agentVersion.id, agentVersion);
    }
  }

  public async saveAgentDefinition(): Promise<void> {
    throw new Error('Not implemented in compiler tests');
  }

  public async findAgentDefinitionById(): Promise<null> {
    return null;
  }

  public async saveAgentVersion(): Promise<void> {
    throw new Error('Not implemented in compiler tests');
  }

  public async findAgentVersionById(): Promise<null> {
    return null;
  }

  public async findPublishedAgentVersionById(
    id: string,
    ownerScopeInput: typeof ownerScope,
  ) {
    const version = this.#publishedAgentVersions.get(id) ?? null;
    return version &&
      version.tenantId === ownerScopeInput.tenantId &&
      version.workspaceId === ownerScopeInput.workspaceId &&
      version.principalType === ownerScopeInput.principalType &&
      version.principalId === ownerScopeInput.principalId
      ? version
      : null;
  }

  public async saveTeamDefinition(): Promise<void> {
    throw new Error('Not implemented in compiler tests');
  }

  public async findTeamDefinitionById(): Promise<null> {
    return null;
  }

  public async saveTeamVersion(): Promise<void> {
    throw new Error('Not implemented in compiler tests');
  }

  public async findTeamVersionById(): Promise<null> {
    return null;
  }

  public async findPublishedTeamVersionById(
    _id: string,
    _ownerScope: typeof ownerScope,
  ): Promise<null> {
    return null;
  }

  public async saveCompiledTeamPlan(): Promise<void> {
    throw new Error('Not implemented in compiler tests');
  }

  public async findCompiledTeamPlanByVersionId(): Promise<null> {
    return null;
  }
}
