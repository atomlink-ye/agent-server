import { describe, expect, it } from 'vitest';

import {
  createDraftAgentVersion,
  publishAgentVersion,
  reviseDraftAgentVersion,
} from './agent-version.js';

const ownerScope = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
};

describe('agent version', () => {
  it('publishes an immutable agent version from a mutable draft', () => {
    const draft = createDraftAgentVersion({
      id: '00000000-0000-4000-8000-000000000101',
      definitionId: '00000000-0000-4000-8000-000000000001',
      ...ownerScope,
      name: 'Research Analyst',
      description: 'Synthesizes grounded research',
      instructions: 'Be precise.',
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    });

    const revised = reviseDraftAgentVersion(
      draft,
      {
        instructions: 'Be precise and cite the provided evidence only.',
      },
      () => new Date('2026-07-22T12:05:00.000Z'),
    );
    const published = publishAgentVersion(
      revised,
      () => new Date('2026-07-22T12:10:00.000Z'),
    );

    expect(revised.status).toBe('draft');
    expect(revised.instructions).toContain('provided evidence only');
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe('2026-07-22T12:10:00.000Z');
    expect(published.updatedAt).toBe('2026-07-22T12:10:00.000Z');
    expect(Object.isFrozen(published)).toBe(true);
    expect(() =>
      reviseDraftAgentVersion(published, {
        instructions: 'Mutate after publish',
      }),
    ).toThrow(/published/i);
    expect(() => publishAgentVersion(published)).toThrow(/published/i);
  });
});
