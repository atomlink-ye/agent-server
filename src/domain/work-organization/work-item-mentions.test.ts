import { describe, expect, it } from 'vitest';

import {
  MAX_WORK_ITEM_MENTIONS,
  mentionSourceText,
  newMentions,
  parseMentions,
  type MentionTarget,
} from './work-item-mentions.js';

const researcher: MentionTarget = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Research Bot',
};
const reviewer: MentionTarget = {
  id: '00000000-0000-4000-8000-0000000000a2',
  name: 'review',
};
const roster: readonly MentionTarget[] = [researcher, reviewer];

describe('parseMentions', () => {
  it('returns nothing for text without an @-token', () => {
    expect(parseMentions('Investigate competitor growth', roster)).toEqual([]);
    expect(parseMentions('', roster)).toEqual([]);
  });

  it('resolves a mention of a target id to that id', () => {
    expect(parseMentions(`ping @${researcher.id} please`, roster)).toEqual([
      researcher.id,
    ]);
  });

  it('resolves a display-name mention to the target id, case-insensitively', () => {
    expect(parseMentions('ping @research bot please', roster)).toEqual([
      researcher.id,
    ]);
  });

  it('prefers the longest matching target token', () => {
    const shadowed: readonly MentionTarget[] = [
      { id: 'id-short', name: 'rev' },
      { id: 'id-long', name: 'reviewer' },
    ];
    expect(parseMentions('@reviewer take a look', shadowed)).toEqual([
      'id-long',
    ]);
  });

  it('falls back to the raw lowercased token when no target matches', () => {
    expect(parseMentions('@Agent-Researcher please help', [])).toEqual([
      'agent-researcher',
    ]);
  });

  it('deduplicates while preserving first-appearance order', () => {
    expect(
      parseMentions(`@review then @${researcher.id} then @review`, roster),
    ).toEqual([reviewer.id, researcher.id]);
  });

  it('ignores the broadcast token', () => {
    expect(parseMentions('@all stand up', roster)).toEqual([]);
  });

  it('requires a non-word boundary before the @', () => {
    expect(parseMentions('mail me at name@review.example', roster)).toEqual([]);
    expect(parseMentions('@@review', roster)).toEqual([]);
  });

  it('requires a token boundary after the match', () => {
    expect(parseMentions('@reviewers are busy', roster)).toEqual([
      // "review" cannot match because "reviewers" continues the token, so the
      // bare-token fallback keeps the literal the author actually typed.
      'reviewers',
    ]);
  });

  it('is pure: the same text always produces the same array', () => {
    const text = `@review and @${researcher.id} and @loose-token`;
    expect(parseMentions(text, roster)).toEqual(parseMentions(text, roster));
  });

  it('ignores targets with a blank token', () => {
    expect(
      parseMentions('@ nobody', [{ id: 'id-blank', name: '   ' }]),
    ).toEqual([]);
  });

  it('bounds the returned mention count', () => {
    const text = Array.from(
      { length: MAX_WORK_ITEM_MENTIONS + 10 },
      (_unused, index) => `@token-${index}`,
    ).join(' ');
    expect(parseMentions(text, [])).toHaveLength(MAX_WORK_ITEM_MENTIONS);
  });

  it('reads a WorkItem mention out of title and description together', () => {
    expect(
      parseMentions(mentionSourceText('@review this', 'cc @all'), roster),
    ).toEqual([reviewer.id]);
  });
});

describe('newMentions', () => {
  it('keeps only mentions the previous save did not already carry', () => {
    expect(newMentions(['a', 'b'], ['b', 'c'])).toEqual(['c']);
  });

  it('is empty when re-saving unchanged prose', () => {
    expect(newMentions(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('treats every mention as new when there was no previous save', () => {
    expect(newMentions([], ['a'])).toEqual(['a']);
  });
});
