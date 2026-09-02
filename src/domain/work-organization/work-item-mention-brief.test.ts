import { describe, expect, it } from 'vitest';

import { workItemMentionBrief } from './work-item-mention-brief.js';

const workItem = {
  id: '00000000-0000-4000-8000-00000000c001',
  title: '审查注册转化漏斗',
  boardId: '00000000-0000-4000-8000-00000000b001',
  columnId: '00000000-0000-4000-8000-00000000d001',
};

describe('workItemMentionBrief', () => {
  it('names the WorkItem and why the agent is being woken', () => {
    const body = workItemMentionBrief({
      reason: 'mention',
      actorLabel: '丹娜',
      workItem,
    });
    expect(body).toContain('审查注册转化漏斗');
    expect(body).toContain(workItem.id);
    expect(body).toContain('丹娜');
    expect(body).toContain('提到了你');
  });

  it('says it was assigned when the wake came from an assignment', () => {
    const body = workItemMentionBrief({
      reason: 'assignment',
      actorLabel: '丹娜',
      workItem,
    });
    expect(body).toContain('指派给了你');
    expect(body).not.toContain('提到了你');
  });

  it('tells the agent the exact tool it has to take the WorkItem', () => {
    const body = workItemMentionBrief({
      reason: 'mention',
      actorLabel: '丹娜',
      workItem,
    });
    expect(body).toContain('agent-server/work-item-claim');
    expect(body).toContain('work_item_id');
  });

  it('reports the board and column when the WorkItem is on a board', () => {
    const body = workItemMentionBrief({
      reason: 'mention',
      actorLabel: '丹娜',
      workItem,
    });
    expect(body).toContain(workItem.boardId);
    expect(body).toContain(workItem.columnId);
  });

  it('omits board wording entirely for a WorkItem that is on no board', () => {
    const body = workItemMentionBrief({
      reason: 'mention',
      actorLabel: '丹娜',
      workItem: { id: workItem.id, title: workItem.title },
    });
    expect(body).not.toContain('看板');
    expect(body).toContain(workItem.id);
  });

  it('names an unnamed actor rather than leaving the sentence headless', () => {
    const body = workItemMentionBrief({
      reason: 'mention',
      actorLabel: '   ',
      workItem,
    });
    expect(body.startsWith('有人 ')).toBe(true);
  });

  it('quotes the comment that carried the mention, trimmed', () => {
    const body = workItemMentionBrief({
      reason: 'comment',
      actorLabel: '丹娜',
      workItem,
      quote: `  能麻烦你看一下   这个吗？\n\n `,
    });
    expect(body).toContain('能麻烦你看一下 这个吗？');
  });

  it('collapses and truncates prose so a wake cannot carry a wall of text', () => {
    const body = workItemMentionBrief({
      reason: 'comment',
      actorLabel: '丹娜',
      workItem: { ...workItem, title: '标'.repeat(400) },
      quote: '文'.repeat(4000),
    });
    expect(body.length).toBeLessThan(1200);
    expect(body).toContain('…');
  });

  it('is pure: the same input always produces the same brief', () => {
    const input = {
      reason: 'mention' as const,
      actorLabel: '丹娜',
      workItem,
    };
    expect(workItemMentionBrief(input)).toBe(workItemMentionBrief(input));
  });
});
