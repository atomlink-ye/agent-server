import type {
  WorkBoardColumnDto,
  WorkItemDto,
} from '@atomlink-ye/agent-server/product-contract';
import { describe, expect, it } from 'vitest';

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
    expect(columnKind(column('In Review'))).toBe('review');
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
  it('answers null while no claim field is present', () => {
    expect(readClaimState(item())).toBeNull();
  });

  it('reads a partial claim record', () => {
    expect(readClaimState(item({ claimed_by: 'ari' }))).toEqual({
      claimedBy: 'ari',
      claimedAt: null,
      expiresAt: null,
    });
  });
});

describe('isClaimable', () => {
  it('falls back to assignment while the claim fields are absent', () => {
    expect(isClaimable(item(), now)).toBe(true);
    expect(isClaimable(item({ assignee_id: 'ari' }), now)).toBe(false);
  });

  it('never offers a claim on a done Task', () => {
    expect(isClaimable(item({ status: 'done' }), now)).toBe(false);
    expect(isClaimable(item({ status: 'done', claimed_by: null }), now)).toBe(
      false,
    );
  });

  it('offers a claim the backend reports as released', () => {
    // A released claim still carries its history, so the record is present
    // with no holder — that is claimable regardless of assignment.
    const released = item({
      claimed_by: null,
      claimed_at: timestamp,
      assignee_id: 'ari',
    });
    expect(isClaimable(released, now)).toBe(true);
  });

  it('refuses a live claim and allows a lapsed one', () => {
    const live = item({
      claimed_by: 'ari',
      claim_expires_at: new Date(now + 60_000).toISOString(),
    });
    const lapsed = item({
      claimed_by: 'ari',
      claim_expires_at: new Date(now - 60_000).toISOString(),
    });
    expect(isClaimable(live, now)).toBe(false);
    expect(isClaimable(lapsed, now)).toBe(true);
  });

  it('refuses a held claim that never expires', () => {
    expect(isClaimable(item({ claimed_by: 'ari' }), now)).toBe(false);
  });

  it('refuses a claim whose expiry it cannot read', () => {
    expect(
      isClaimable(item({ claimed_by: 'ari', claim_expires_at: 'soon' }), now),
    ).toBe(false);
  });
});

describe('claimBlockedReason', () => {
  it('says nothing while the Task is claimable', () => {
    expect(claimBlockedReason(item(), now)).toBeNull();
  });

  it('explains a done Task', () => {
    expect(claimBlockedReason(item({ status: 'done' }), now)).toBe(
      '这个任务已经完成了。',
    );
  });

  it('names the holder from the claim record or the assignee', () => {
    expect(claimBlockedReason(item({ claimed_by: 'ari' }), now)).toBe(
      '这个任务已被 ari 领取。',
    );
    expect(claimBlockedReason(item({ assignee_id: 'bo' }), now)).toBe(
      '这个任务已被 bo 领取。',
    );
  });
});
