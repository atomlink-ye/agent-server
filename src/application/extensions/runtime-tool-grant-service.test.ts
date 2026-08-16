import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  RuntimeToolGrantService,
} from './runtime-tool-grant-service.js';

const base = {
  tenantId: 'tenant-1',
  principalType: 'service_account',
  principalId: 'principal-1',
  workspaceId: 'workspace-1',
  allowedTools: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
};

function issue(
  service: RuntimeToolGrantService,
  input: Partial<Parameters<RuntimeToolGrantService['issue']>[0]> = {},
) {
  return service.issue({
    ...base,
    productSessionId: 'member-1',
    teamMemberRunId: 'member-1',
    teamRunId: 'team-1',
    ...input,
  });
}

describe('RuntimeToolGrantService', () => {
  afterEach(() => vi.useRealTimers());

  it('replaces a team-member grant and invalidates the old bearer', () => {
    const service = new RuntimeToolGrantService();
    const first = issue(service, { runId: 'run-1' });
    const second = issue(service, { runId: 'run-2' });

    expect(service.resolve(first.token)).toBeNull();
    expect(service.resolve(second.token)?.activeTurn?.runId).toBe('run-2');
  });

  it('keeps grants for different scopes independent', () => {
    const service = new RuntimeToolGrantService();
    const first = issue(service, { productSessionId: 'member-1' });
    const second = issue(service, { productSessionId: 'member-2' });

    expect(service.resolve(first.token)?.productSessionId).toBe('member-1');
    expect(service.resolve(second.token)?.productSessionId).toBe('member-2');
  });

  it('fences replacement while the old grant has active calls', () => {
    const service = new RuntimeToolGrantService();
    const first = issue(service);
    service.beginToolCall(first.receipt.grantId);

    expect(() => issue(service, { runId: 'run-2' })).toThrow(
      'Runtime grant replacement fence is active.',
    );
    expect(service.activeToolCalls(first.receipt.grantId)).toBe(1);
  });

  it('revokes every grant in a TeamRun without erasing active-call accounting', () => {
    const service = new RuntimeToolGrantService();
    const active = issue(service);
    const other = issue(service, {
      productSessionId: 'member-2',
      teamMemberRunId: 'member-2',
      teamRunId: 'team-2',
    });
    service.beginToolCall(active.receipt.grantId);
    service.revokeForTeamRun('team-1');

    expect(service.resolve(active.token)).toBeNull();
    expect(service.resolve(other.token)?.teamRunId).toBe('team-2');
    expect(service.activeToolCalls(active.receipt.grantId)).toBe(1);
    service.endToolCall(active.receipt.grantId);
    expect(service.activeToolCalls(active.receipt.grantId)).toBe(0);
  });

  it('prunes expired idle grants and retains expired active grants until their call ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
    const service = new RuntimeToolGrantService();
    const idle = service.issue({
      ...base,
      productSessionId: 'idle',
      ttlMs: 10,
    });
    const active = service.issue({
      ...base,
      productSessionId: 'active',
      ttlMs: 10,
    });
    service.beginToolCall(active.receipt.grantId);
    vi.advanceTimersByTime(20);

    expect(
      service.getForTeamMember({ teamMemberRunId: 'idle', scopeId: 'idle' }),
    ).toBeNull();
    expect(service.resolve(idle.token)).toBeNull();
    expect(service.resolve(active.token)).toBeNull();
    expect(service.activeToolCalls(active.receipt.grantId)).toBe(1);
    service.endToolCall(active.receipt.grantId);
    expect(service.activeToolCalls(active.receipt.grantId)).toBe(0);
    expect(service.get(active.receipt.grantId)).toBeNull();
  });

  it('reports a missing Team grant scope distinctly from ambiguity', () => {
    const service = new RuntimeToolGrantService();

    expect(() =>
      service.refreshForTeamMember({
        grantId: 'missing',
        teamMemberRunId: 'member-1',
        scopeId: 'member-1',
        taskId: 'task-1',
        runId: 'run-1',
        allowedTools: [],
        contextEpoch: 'epoch-1',
      }),
    ).toThrow('Runtime grant scope not found.');
  });

  it('retains an expired narrowed Team lead bearer for the next turn refresh', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
    const service = new RuntimeToolGrantService();
    const first = issue(service, {
      taskId: 'task-1',
      runId: 'run-1',
      contextEpoch: 'epoch-1',
      ttlMs: 100,
    });
    const turnOne = service.refreshForTeamMember({
      grantId: first.receipt.grantId,
      teamMemberRunId: 'member-1',
      scopeId: 'member-1',
      taskId: 'task-1',
      runId: 'run-1',
      allowedTools: [],
      contextEpoch: 'epoch-1',
      ttlMs: 10,
    });
    expect(turnOne.allowedTools).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(service.resolve(first.token)).toBeNull();

    const turnTwo = service.refreshForTeamMember({
      grantId: first.receipt.grantId,
      teamMemberRunId: 'member-1',
      scopeId: 'member-1',
      taskId: 'task-2',
      runId: 'run-2',
      allowedTools: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
      contextEpoch: 'epoch-2',
      ttlMs: 100,
    });
    expect(turnTwo.grantId).toBe(first.receipt.grantId);
    expect(service.resolve(first.token)).toMatchObject({
      grantId: first.receipt.grantId,
      activeTurn: {
        taskId: 'task-2',
        runId: 'run-2',
        contextEpoch: 'epoch-2',
      },
      allowedTools: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
    });
  });

  it('closes a Team turn explicitly and fences active calls', () => {
    const service = new RuntimeToolGrantService();
    const grant = issue(service, {
      taskId: 'task-1',
      runId: 'run-1',
      contextEpoch: 'epoch-1',
    });

    service.beginToolCall(grant.receipt.grantId);
    expect(() =>
      service.closeTeamMemberTurn({
        grantId: grant.receipt.grantId,
        teamMemberRunId: 'member-1',
        scopeId: 'member-1',
      }),
    ).toThrow('Runtime turn close fence is active.');
    service.endToolCall(grant.receipt.grantId);

    const closed = service.closeTeamMemberTurn({
      grantId: grant.receipt.grantId,
      teamMemberRunId: 'member-1',
      scopeId: 'member-1',
    });
    expect(closed.activeTurn).toBeNull();
    expect(closed.allowedTools).toEqual([]);
  });

  it('deletes an expired Team tombstone when its TeamRun is revoked', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
    const service = new RuntimeToolGrantService();
    const grant = issue(service, { ttlMs: 10 });
    vi.advanceTimersByTime(20);

    expect(service.resolve(grant.token)).toBeNull();
    expect(service.get(grant.receipt.grantId)).not.toBeNull();
    expect(
      service.getForTeamMember({
        teamMemberRunId: 'member-1',
        scopeId: 'member-1',
      }),
    ).not.toBeNull();
    service.revokeForTeamRun('team-1');
    expect(service.get(grant.receipt.grantId)).toBeNull();
    expect(
      service.getForTeamMember({
        teamMemberRunId: 'member-1',
        scopeId: 'member-1',
      }),
    ).toBeNull();
    expect(service.resolve(grant.token)).toBeNull();
  });
});
