import { describe, expect, it } from 'vitest';

import {
  completeMention,
  extractMentionIds,
  findMentionSpans,
  mentionToken,
  opensMention,
  readMentionDraft,
} from './mentions';

describe('mentionToken', () => {
  it('writes the participant id, not a display name', () => {
    expect(mentionToken('ari-analyst')).toBe('@ari-analyst');
  });
});

describe('findMentionSpans', () => {
  it('finds every mention in reading order', () => {
    const spans = findMentionSpans('ask @ari then @bo');
    expect(spans.map((span) => span.id)).toEqual(['ari', 'bo']);
    expect(spans[0]).toEqual({ id: 'ari', start: 4, end: 8 });
  });

  it('stops the token before trailing punctuation', () => {
    expect(findMentionSpans('ping @ari-analyst.')[0]).toEqual({
      id: 'ari-analyst',
      start: 5,
      end: 17,
    });
  });

  it('round-trips a uuid participant id', () => {
    const id = '3f0c1a2b-4d5e-6f70-8192-a3b4c5d6e7f8';
    expect(findMentionSpans(`hi @${id}`)[0]?.id).toBe(id);
  });

  it('ignores an @ inside an email address', () => {
    expect(findMentionSpans('mail you@example.com')).toEqual([]);
  });

  it('ignores a bare @', () => {
    expect(findMentionSpans('cost @ 5')).toEqual([]);
  });
});

describe('extractMentionIds', () => {
  it('de-duplicates repeated mentions', () => {
    expect(extractMentionIds('@ari and @bo and @ari')).toEqual(['ari', 'bo']);
  });
});

describe('opensMention', () => {
  it('opens at the start of the text and after whitespace', () => {
    expect(opensMention('@ari', 0)).toBe(true);
    expect(opensMention('hi @ari', 3)).toBe(true);
  });

  it('does not open mid-word', () => {
    expect(opensMention('you@host', 3)).toBe(false);
  });
});

describe('readMentionDraft', () => {
  it('reads the token the caret sits inside', () => {
    expect(readMentionDraft('ask @ar', 7)).toEqual({ anchor: 4, query: 'ar' });
  });

  it('reads an empty query right after the @', () => {
    expect(readMentionDraft('ask @', 5)).toEqual({ anchor: 4, query: '' });
  });

  it('closes once the caret leaves the token', () => {
    expect(readMentionDraft('ask @ari now', 12)).toBeNull();
  });

  it('closes when the @ does not open a mention', () => {
    expect(readMentionDraft('you@ex', 6)).toBeNull();
  });

  it('closes when there is no @ behind the caret', () => {
    expect(readMentionDraft('plain text', 5)).toBeNull();
  });

  it('reads the nearest open token when several exist', () => {
    expect(readMentionDraft('@ari and @bo', 12)).toEqual({
      anchor: 9,
      query: 'bo',
    });
  });
});

describe('completeMention', () => {
  it('replaces the open token and leaves a trailing space', () => {
    const draft = readMentionDraft('ask @ar', 7)!;
    expect(completeMention('ask @ar', draft, 7, 'ari-analyst')).toEqual({
      text: 'ask @ari-analyst ',
      caret: 17,
    });
  });

  it('keeps the text that follows the caret', () => {
    const text = 'ask @ar about it';
    const draft = readMentionDraft(text, 7)!;
    expect(completeMention(text, draft, 7, 'ari').text).toBe(
      'ask @ari about it',
    );
  });

  it('produces a token the extractor reads back', () => {
    const draft = readMentionDraft('@', 1)!;
    const completed = completeMention('@', draft, 1, 'bo.chen');
    expect(extractMentionIds(completed.text)).toEqual(['bo.chen']);
  });
});
