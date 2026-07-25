import { describe, expect, it } from 'vitest';
import {
  renderCardWithDocControls,
  renderPendingMemoryCard,
  renderResolvedMemoryCard,
  type MemoryCard,
} from './lark-memory-card.js';

const token = 'surface-token-opaque';

function json(card: MemoryCard): string {
  return JSON.stringify(card);
}

function buttons(card: MemoryCard): Array<Record<string, unknown>> {
  const columnSet = card.body.elements.find(
    (element) => element.tag === 'column_set',
  );
  if (!columnSet || columnSet.tag !== 'column_set')
    throw new Error('button column set missing');
  return columnSet.columns.flatMap((column) =>
    column.elements.filter((element) => element.tag === 'button'),
  ) as Array<Record<string, unknown>>;
}

describe('Lark memory Card 2.0 renderers', () => {
  it('renders a concise pending proposal with accessible hierarchy and safe callbacks', () => {
    const card = renderPendingMemoryCard({
      category: 'Customer preferences',
      content:
        'The customer prefers email updates.\n<at user_id="ou_secret">Notify them.</at>',
      token,
    });
    const output = json(card);

    expect(card.schema).toBe('2.0');
    expect(card.config).toMatchObject({
      update_multi: true,
      enable_forward: false,
      width_mode: 'default',
    });
    expect(output).toContain('Workspace memory review');
    expect(output).toContain('Customer preferences');
    expect(output).toContain('The customer prefers email updates.');
    expect(output).toContain(
      'Proposed by the completed agent task in this thread.',
    );
    expect(output).not.toContain('ou_secret');
    expect(output).not.toContain('<at');
    expect(output).not.toContain('proposal-');
    expect(output).not.toContain('run-');

    const columnSet = card.body.elements.find(
      (element) => element.tag === 'column_set',
    );
    expect(columnSet?.tag).toBe('column_set');
    if (!columnSet || columnSet.tag !== 'column_set')
      throw new Error('missing column set');
    expect(columnSet.flex_mode).toBe('flow');
    expect(columnSet.columns.every((column) => column.tag === 'column')).toBe(
      true,
    );
    expect(buttons(card).map((button) => button.type)).toEqual([
      'primary_filled',
      'default',
      'danger',
    ]);
    expect(
      buttons(card).map(
        (button) => (button.text as { content: string }).content,
      ),
    ).toEqual([['Accept', 'Edit in Doc', 'Reject']].flat());
    for (const button of buttons(card)) {
      const callback = (
        button.behaviors as Array<Record<string, unknown>>
      ).find((behavior) => behavior.type === 'callback');
      expect(callback?.value).toEqual({
        action: expect.stringMatching(/^(accept|edit_in_doc|reject)$/),
        token,
      });
      expect(JSON.stringify(callback?.value)).not.toMatch(
        /proposal|run|owner|content/i,
      );
    }
    expect(buttons(card)[2]).toHaveProperty('confirm');
  });

  it('rejects proposal content that cannot fit on the short Card', () => {
    const content =
      Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\n') +
      'x'.repeat(2_000);
    expect(() =>
      renderPendingMemoryCard({ category: 'Notes', content, token }),
    ).toThrow(/short Card/);
  });

  it('rejects empty, whitespace, and oversized callback tokens', () => {
    for (const invalidToken of ['', '   ', 'x'.repeat(257)]) {
      expect(() =>
        renderPendingMemoryCard({
          category: 'Notes',
          content: 'A bounded proposal.',
          token: invalidToken,
        }),
      ).toThrow(/token/);
    }
  });

  it('uses the UTF-8 byte bound for multibyte callback tokens', () => {
    const exact = 'é'.repeat(128);
    expect(() =>
      renderPendingMemoryCard({
        category: 'Notes',
        content: 'x',
        token: exact,
      }),
    ).not.toThrow();
    expect(() =>
      renderPendingMemoryCard({
        category: 'Notes',
        content: 'x',
        token: `${exact}é`,
      }),
    ).toThrow(/token/);
  });

  it('renders direct doc acceptance without preview controls', () => {
    const card = renderCardWithDocControls({
      category: 'Project context',
      excerpt: 'A readable excerpt from the memory document.',
      docStatus: 'Ready',
      docUrl: 'https://docs.example.test/memory',
      token,
      previewed: false,
    });
    const output = json(card);
    expect(output).toContain('Project context');
    expect(output).toContain('**Doc status**\\nReady');
    expect(output).toContain('A readable excerpt');
    expect(output).toContain('https://docs.example.test/memory');
    expect(
      buttons(card).map(
        (button) => (button.text as { content: string }).content,
      ),
    ).toEqual(['Open Doc', 'Accept', 'Reject']);
    expect(buttons(card)[0]!.behaviors).toEqual([
      { type: 'open_url', default_url: 'https://docs.example.test/memory' },
    ]);
    expect(buttons(card)[1]!.behaviors).toEqual([
      { type: 'callback', value: { action: 'accept', token } },
    ]);
  });

  it('never renders preview UI for legacy previewed input', () => {
    const card = renderCardWithDocControls({
      category: 'Project context',
      excerpt: 'Previewed content.',
      docStatus: 'Ready',
      docUrl: 'https://docs.example.test/memory',
      token,
      previewed: true,
      previewExcerpt: 'This is the immutable preview.',
      previewFingerprint: '0123456789abcdef',
    });
    const output = json(card);
    expect(output).not.toContain('Preview fingerprint');
    expect(output).not.toContain('Accept Preview');
    expect(
      buttons(card).map(
        (button) => (button.text as { content: string }).content,
      ),
    ).toEqual(['Open Doc', 'Accept', 'Reject']);
    expect(buttons(card)[1]!.behaviors).toEqual([
      { type: 'callback', value: { action: 'accept', token } },
    ]);
  });

  it('renders terminal accepted and rejected cards without active buttons', () => {
    for (const status of ['accepted', 'rejected'] as const) {
      const card = renderResolvedMemoryCard({
        status,
        category: 'Decision',
        content:
          status === 'accepted'
            ? 'Keep weekly summaries.'
            : 'Do not retain this note.',
      });
      const output = json(card);
      expect(output).toContain(
        status === 'accepted' ? 'Memory accepted' : 'Memory rejected',
      );
      expect(output).toContain(
        status === 'accepted'
          ? 'Keep weekly summaries.'
          : 'Do not retain this note.',
      );
      expect(
        card.body.elements.some((element) => element.tag === 'column_set'),
      ).toBe(false);
    }
  });

  it('escapes hostile category and excerpt text without breaking links or mentions', () => {
    const card = renderCardWithDocControls({
      category: '[admin](https://evil.test) <at id="secret">',
      excerpt:
        '`x` **bold** [steal](https://evil.test)\n<at user_id="secret">ping</at>',
      docStatus: 'Draft',
      docUrl: 'https://docs.example.test/safe',
      token,
      previewed: false,
    });
    const output = json(card);
    expect(
      card.body.elements.some(
        (element) =>
          element.tag === 'markdown' &&
          element.content.includes('\\[admin\\]\\(https://evil.test\\)'),
      ),
    ).toBe(true);
    expect(
      card.body.elements.some(
        (element) =>
          element.tag === 'markdown' && element.content.includes('secret'),
      ),
    ).toBe(false);
    expect(output).not.toContain('**bold**');
    expect(output).not.toContain('<at user_id');
    expect(output).toContain('https://docs.example.test/safe');
  });
});
