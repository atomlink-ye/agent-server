import { describe, expect, it } from 'vitest';

import type { TeamWorkItem } from '../teams/team-work-item.js';
import { orderedWorkItems, resolveWorkRef, workRef } from './collaboration.js';

function item(id: string): TeamWorkItem {
  return {
    id,
    teamRunId: 'team-1',
    subject: id,
    description: null,
    status: 'open',
    ownerMemberId: null,
    createdByMemberId: 'lead-1',
    completionSummary: null,
    executionTaskId: null,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'service_account',
    principalId: 'principal-1',
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    completedAt: null,
  };
}

describe('collaboration logical references', () => {
  it('uses id as a deterministic tie breaker when Work items share a timestamp', () => {
    const first = item('00000000-0000-4000-8000-000000000001');
    const second = item('00000000-0000-4000-8000-000000000002');
    const ordered = orderedWorkItems([second, first]);

    expect(
      ordered.map((candidate, index) => [workRef(index), candidate.id]),
    ).toEqual([
      ['W-1', first.id],
      ['W-2', second.id],
    ]);
    expect(resolveWorkRef('W-1', [second, first])?.id).toBe(first.id);
    expect(resolveWorkRef('W-2', [second, first])?.id).toBe(second.id);
  });
});
