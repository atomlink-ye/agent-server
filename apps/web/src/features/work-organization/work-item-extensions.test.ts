import type {
  WorkBoardColumnDto,
  WorkItemDto,
} from '@atomlink-ye/agent-server/product-contract';
import { describe, expect, it } from 'vitest';

import type { Participant } from './participants';
import {
  claimBlockedReason,
  columnKind,
  findDoingColumn,
  isClaimable,
  readClaimState,
  readColumnKind,
  readCommentCount,
  readMentionIds,
} from './work-item-extensions';

const timestamp = '2026-09-01T00:00:00.000Z';
const now = Date.parse(timestamp);

function item(extra: Record<string, unknown> = {}): WorkItemDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '00000000-0000-4000-8000-000000000001',
    title: 'Ship the Board',
    description: null,
    status: 'todo',
    assignee_id: null,
    created_by: 'user-1',
    source_conversation_id: null,
    source_message_id: null,
    linked_work_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...extra,
  } as WorkItemDto;
}

function column(title: string, extra: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    board_id: '33333333-3333-4333-8333-333333333333',
    title,
    position: 1000,
    created_at: timestamp,
    updated_at: timestamp,
    ...extra,
  } as WorkBoardColumnDto;
}

describe('readMentionIds', () => {
  it('answers null while the backend field is absent', () => {
    expect(readMentionIds(item())).toBeNull();
  });

  it('tells an empty mention list apart from an absent one', () => {
    expect(readMentionIds(item({ mentions: [] }))).toEqual([]);
  });

  it('reads the reported mention ids', () => {
    expect(readMentionIds(item({ mentions: ['ari', 'bo'] }))).toEqual([
      'ari',
      'bo',
    ]);
  });

  it('rejects a list that is not all non-empty strings', () => {
    expect(readMentionIds(item({ mentions: ['ari', 7] }))).toBeNull();
    expect(readMentionIds(item({ mentions: ['ari', ''] }))).toBeNull();
    expect(readMentionIds(item({ mentions: 'ari' }))).toBeNull();
  });
});

describe('readCommentCount', () => {
  it('answers null while the field is absent', () => {
    expect(readCommentCount(item())).toBeNull();
  });

  it('reads a reported count, including zero', () => {
    expect(readCommentCount(item({ comment_count: 0 }))).toBe(0);
    expect(readCommentCount(item({ comment_count: 3 }))).toBe(3);
  });

  it('rejects a nonsense count', () => {
    expect(readCommentCount(item({ comment_count: -1 }))).toBeNull();
    expect(readCommentCount(item({ comment_count: 'many' }))).toBeNull();
    expect(readCommentCount(item({ comment_count: Number.NaN }))).toBeNull();
  });
});

describe('readColumnKind / columnKind', () => {
  it('answers null for a declared kind that is absent', () => {
    expect(readColumnKind(column('Doing'))).toBeNull();
  });

  it('prefers the declared kind over the title', () => {
    expect(readColumnKind(column('Anything', { kind: 'doing' }))).toBe('doing');
    expect(columnKind(column('Done', { kind: 'todo' }))).toBe('todo');
  });

  it('ignores a kind outside the known set', () => {
    expect(readColumnKind(column('Doing', { kind: 'blocked' }))).toBeNull();
  });

  it('guesses from the title while the field is absent', () => {
    expect(columnKind(column('In Progress'))).toBe('doing');
    expect(columnKind(column('WIP'))).toBe('doing');
    expect(columnKind(column('In Review'))).toBe('doing');
    expect(columnKind(column('Completed'))).toBe('done');
    expect(columnKind(column('Backlog'))).toBe('todo');
  });

  it('answers null for a title it cannot read', () => {
    expect(columnKind(column('Icebox'))).toBeNull();
  });
});

describe('findDoingColumn', () => {
  it('finds the declared doing column', () => {
    const columns = [
      column('A', { kind: 'todo' }),
      column('B', { kind: 'doing' }),
    ];
    expect(findDoingColumn(columns)?.title).toBe('B');
  });

  it('answers null when the Board has no doing column', () => {
    expect(findDoingColumn([column('Icebox')])).toBeNull();
  });
});

describe('readClaimState', () => {
  it('answers null on an unassigned WorkItem', () => {
    expect(readClaimState(item())).toBeNull();
  });

  it('reads the assignee as the claim holder, timestamped by updated_at', () => {
    expect(
      readClaimState(item({ assignee_id: 'ari', updated_at: timestamp })),
    ).toEqual({ claimedBy: 'ari', claimedAt: timestamp });
  });
});

describe('isClaimable', () => {
  it('is claimable while unassigned', () => {
    expect(isClaimable(item(), now)).toBe(true);
  });

  it('is not claimable while freshly assigned', () => {
    expect(
      isClaimable(item({ assignee_id: 'ari', updated_at: timestamp }), now),
    ).toBe(false);
  });

  it('never offers a claim on a done Task, even unassigned', () => {
    expect(isClaimable(item({ status: 'done' }), now)).toBe(false);
  });

  it('becomes claimable again once the assignment goes stale (20 minutes)', () => {
    const justUnder = new Date(now - 19 * 60 * 1000).toISOString();
    const justOver = new Date(now - 20 * 60 * 1000).toISOString();
    expect(
      isClaimable(item({ assignee_id: 'ari', updated_at: justUnder }), now),
    ).toBe(false);
    expect(
      isClaimable(item({ assignee_id: 'ari', updated_at: justOver }), now),
    ).toBe(true);
  });

  it('refuses a claim whose updated_at it cannot read', () => {
    expect(
      isClaimable(item({ assignee_id: 'ari', updated_at: 'soon' }), now),
    ).toBe(false);
  });
});

describe('claimBlockedReason', () => {
  const participant: Participant = {
    id: 'ari',
    name: 'Ari Analyst',
    kind: 'agent',
    detail: null,
    active: true,
  };

  it('says nothing while the Task is claimable', () => {
    expect(claimBlockedReason(item(), now, [])).toBeNull();
  });

  it('explains a done Task', () => {
    expect(claimBlockedReason(item({ status: 'done' }), now, [])).toBe(
      '这个任务已经完成了。',
    );
  });

  it('names the holder from the current assignee', () => {
    expect(
      claimBlockedReason(
        item({ assignee_id: 'ari', updated_at: timestamp }),
        now,
        [participant],
      ),
    ).toBe('这个任务已被 Ari Analyst 领取。');
  });

  it('falls back without exposing the raw id when the holder is unresolved', () => {
    const holderId = '11111111-1111-4111-8111-111111111111';
    expect(
      claimBlockedReason(
        item({ assignee_id: holderId, updated_at: timestamp }),
        now,
        [],
      ),
    ).toBe('这个任务已被 该同事 领取。');
  });
});
