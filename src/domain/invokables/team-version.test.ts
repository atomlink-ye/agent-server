import { describe, expect, it } from 'vitest';

import { createDraftTeamVersion, publishTeamVersion } from './team-version.js';

const ownerScope = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
};

const spec = {
  lead: {
    name: 'Lead',
    agentVersionId: '00000000-0000-4000-8000-000000001001',
  },
  roster: [
    {
      name: 'Analyst',
      agentVersionId: '00000000-0000-4000-8000-000000001003',
    },
    {
      name: 'Researcher',
      agentVersionId: '00000000-0000-4000-8000-000000001002',
    },
  ],
  environmentVersionId: '00000000-0000-4000-8000-000000002001',
} as const;

describe('team version', () => {
  it('publishes the canonical fixed-roster Team spec immutably', () => {
    const draft = createDraftTeamVersion({
      id: '00000000-0000-4000-8000-000000000201',
      definitionId: '00000000-0000-4000-8000-000000000002',
      ...ownerScope,
      name: 'Research Team',
      description: 'Collects and summarizes',
      spec,
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });

    const published = publishTeamVersion(
      draft,
      () => new Date('2026-07-22T12:10:00.000Z'),
    );

    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe('2026-07-22T12:10:00.000Z');
    expect(published.spec).toEqual(spec);
    expect(published.environmentVersionId).toBe(spec.environmentVersionId);
    expect(() => publishTeamVersion(published)).toThrow(/immutable/i);
  });

  it('rejects an empty roster', () => {
    expect(() =>
      createDraftTeamVersion({
        definitionId: '00000000-0000-4000-8000-000000000002',
        ...ownerScope,
        name: 'Invalid Team',
        spec: { ...spec, roster: [] },
      }),
    ).toThrow(/at least one/i);
  });
});
