import { describe, expect, it } from 'vitest';

import {
  createDraftTeamVersion,
  publishTeamVersion,
  reviseDraftTeamVersion,
} from './team-version.js';

const ownerScope = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
};

describe('team version', () => {
  it('publishes a sequential team with its compiled plan attached', () => {
    const draft = createDraftTeamVersion({
      id: '00000000-0000-4000-8000-000000000201',
      definitionId: '00000000-0000-4000-8000-000000000002',
      ...ownerScope,
      name: 'Sequential Research Team',
      description: 'Collects, analyzes, and summarizes',
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
            successNodeId: null,
            output: 'final',
          },
        ],
      },
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });

    const revised = reviseDraftTeamVersion(
      draft,
      {
        description: 'Collects, analyzes, and emits the final output',
      },
      () => new Date('2026-07-22T12:05:00.000Z'),
    );
    const published = publishTeamVersion(
      revised,
      {
        compilerVersion: 'sequential-mvp-v1',
        teamVersionId: revised.id,
        entryNodeId: 'collect',
        finalOutputNodeId: 'analyze',
        compiledAt: '2026-07-22T12:10:00.000Z',
        steps: [
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
            output: 'final',
          },
        ],
      },
      () => new Date('2026-07-22T12:10:00.000Z'),
    );

    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe('2026-07-22T12:10:00.000Z');
    expect(published.compiledPlan?.finalOutputNodeId).toBe('analyze');
    expect(() =>
      reviseDraftTeamVersion(published, {
        name: 'Mutated Team',
      }),
    ).toThrow(/published/i);
  });
});
