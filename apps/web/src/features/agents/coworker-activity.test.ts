import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock('../../api/transport', () => ({
  apiTransport: {
    request: (...args: [string, RequestInit?]) => request(...args),
  },
}));

const loadConversations = vi.fn();
vi.mock('../conversations/conversations-gateway', () => ({
  loadConversations: () => loadConversations(),
}));

const { formatActivityTime, loadCoworkerActivity, sortByRecency } =
  await import('./coworker-activity');

const AGENT_ID = '123e4567-e89b-42d3-a456-426614174000';
const MINE = '223e4567-e89b-42d3-a456-426614174001';
const THEIRS = '323e4567-e89b-42d3-a456-426614174002';

function work(overrides: Record<string, unknown>) {
  return {
    id: '423e4567-e89b-42d3-a456-426614174003',
    tenant_id: 'tenant-1',
    workspace_id: '923e4567-e89b-42d3-a456-426614174008',
    definition_id: MINE,
    definition_version_id: '523e4567-e89b-42d3-a456-426614174004',
    title: 'Market brief',
    origin: 'created',
    archived_at: null,
    created_at: '2026-09-07T10:00:00.000Z',
    updated_at: '2026-09-07T10:00:00.000Z',
    product_state: 'complete',
    latest_run_summary: null,
    ...overrides,
  };
}

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    kind: 'direct',
    title: 'Weekly sync',
    directAgent: { agentDefinitionId: AGENT_ID, displayName: 'Maya' },
    updatedAt: '2026-09-07T11:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  request.mockReset();
  loadConversations.mockReset();
});

describe('Coworker recent activity', () => {
  it('keeps only Work built on this Coworker’s Capabilities and its own chats', async () => {
    request.mockResolvedValue({
      works: [
        work({}),
        work({
          id: '623e4567-e89b-42d3-a456-426614174005',
          definition_id: THEIRS,
          title: 'Someone else’s Work',
        }),
      ],
      next_cursor: null,
    });
    loadConversations.mockResolvedValue([
      conversation(),
      conversation({
        id: 'conv-2',
        directAgent: { agentDefinitionId: THEIRS, displayName: 'Other' },
      }),
      conversation({ id: 'conv-3', directAgent: null }),
    ]);

    const activity = await loadCoworkerActivity({
      agentId: AGENT_ID,
      capabilityDefinitionIds: [MINE],
    });

    expect(activity.items.map((item) => item.title)).toEqual([
      'Weekly sync',
      'Market brief',
    ]);
    expect(activity.work).toBe('ok');
    expect(activity.chat).toBe('ok');
  });

  it('drops archived Work and prefers the latest run time', async () => {
    request.mockResolvedValue({
      works: [
        work({
          archived_at: '2026-09-06T10:00:00.000Z',
          title: 'Archived',
        }),
        work({
          id: '723e4567-e89b-42d3-a456-426614174006',
          title: 'Re-run',
          latest_run_summary: {
            id: '823e4567-e89b-42d3-a456-426614174007',
            updated_at: '2026-09-07T12:00:00.000Z',
            result_summary: 'Two competitors profiled.',
            result_capture_status: 'present',
          },
        }),
      ],
      next_cursor: null,
    });
    loadConversations.mockResolvedValue([conversation()]);

    const activity = await loadCoworkerActivity({
      agentId: AGENT_ID,
      capabilityDefinitionIds: [MINE],
    });

    expect(activity.items.map((item) => item.title)).toEqual([
      'Re-run',
      'Weekly sync',
    ]);
    expect(activity.items[0]?.detail).toBe('Two competitors profiled.');
    expect(activity.items[0]?.at).toBe('2026-09-07T12:00:00.000Z');
  });

  it('never asks for Work when the Coworker has no Capabilities', async () => {
    loadConversations.mockResolvedValue([]);

    const activity = await loadCoworkerActivity({
      agentId: AGENT_ID,
      capabilityDefinitionIds: [],
    });

    expect(request).not.toHaveBeenCalled();
    expect(activity.work).toBe('skipped');
    expect(activity.items).toEqual([]);
  });

  it('reports a failed source instead of hiding it behind an empty list', async () => {
    request.mockRejectedValue(new Error('boom'));
    loadConversations.mockResolvedValue([conversation()]);

    const activity = await loadCoworkerActivity({
      agentId: AGENT_ID,
      capabilityDefinitionIds: [MINE],
    });

    expect(activity.work).toBe('failed');
    expect(activity.chat).toBe('ok');
    expect(activity.items).toHaveLength(1);
  });

  it('orders merged entries newest first', () => {
    const items = ['2026-09-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z'].map(
      (at, index) => ({
        id: `item-${index}`,
        kind: 'chat' as const,
        title: at,
        detail: null,
        state: null,
        at,
        to: '/',
      }),
    );
    expect(sortByRecency(items).map((item) => item.at)).toEqual([
      '2026-09-05T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    ]);
  });
});

describe('activity timestamps', () => {
  const now = Date.parse('2026-09-07T12:00:00.000Z');

  it('reads as elapsed time while the entry is recent', () => {
    expect(formatActivityTime('2026-09-07T11:59:30.000Z', now)).toBe(
      'Just now',
    );
    expect(formatActivityTime('2026-09-07T11:30:00.000Z', now)).toBe('30m ago');
    expect(formatActivityTime('2026-09-07T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatActivityTime('2026-09-05T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('returns null rather than inventing a time for an unparseable value', () => {
    expect(formatActivityTime('not-a-date', now)).toBeNull();
  });
});
