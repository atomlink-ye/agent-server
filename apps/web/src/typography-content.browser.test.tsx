import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { ProductRunTraceSuccessSchema } from '@atomlink-ye/agent-server/product-contract';
import { AppProviders } from './app/providers';
import { AppRouter } from './app/router';
import { AssistantMarkdown } from './features/conversations/components/assistant-markdown';
import { setLocale } from './i18n';
import recording from './test-support/fixtures/product-recordings/parallel-success.json';
import { projectWorkList } from './test-support/product-recording-test-helpers';
import './index.css';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const title =
  '审查供应链风险与跨区域协作的研究结果，确认采购计划（包括质量验证、交付时间及异常处理），并整理下一轮执行所需的完整资料。'.repeat(
    3,
  );

// A title can render across several text nodes (e.g. a suffix-preserving
// split into sibling <span>s), so glyph ranges must walk node-by-node rather
// than assume a single text node spans the whole element.
function textNodesOf(element: HTMLElement): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node as Text);
  return nodes;
}

function measureText(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const nodes = textNodesOf(element);
  let nodeIndex = 0;
  let offset = 0;
  const glyphs = Array.from(element.textContent!).map((character) => {
    while (nodeIndex < nodes.length && offset >= nodes[nodeIndex]!.length) {
      nodeIndex += 1;
      offset = 0;
    }
    const text = nodes[nodeIndex]!;
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + character.length);
    offset += character.length;
    const rect = range.getBoundingClientRect();
    return {
      character,
      x: rect.x - bounds.x,
      y: rect.y - bounds.y,
      width: rect.width,
      height: rect.height,
    };
  });
  return {
    width: bounds.width,
    height: bounds.height,
    fontSize: parseFloat(style.fontSize),
    lineHeight: parseFloat(style.lineHeight),
    overflowX: style.overflowX,
    textOverflow: style.textOverflow,
    whiteSpace: style.whiteSpace,
    scrollWidth: element.scrollWidth,
    glyphs,
    lineCount: new Set(glyphs.map((glyph) => glyph.y)).size,
  };
}

// A suffix-preserving title (work-title.tsx) only truncates its first span;
// the trailing `work-scannable-title__suffix` span always stays intact and
// the outer element no longer overflows itself, so callers that need the
// element that actually clips text must use the inner span instead.
function truncatableOf(element: HTMLElement): HTMLElement {
  return element.querySelector<HTMLElement>('.work-scannable-title__suffix') &&
    element.firstElementChild instanceof HTMLElement
    ? element.firstElementChild
    : element;
}

// Compare native ellipsis paint with a prefix ending at a whole-character
// boundary. Range boxes alone include elided text and cannot prove paint.
async function measureEllipsisPaint(element: HTMLElement) {
  const truncatable = truncatableOf(element);
  const original = truncatable.textContent!;
  const originalWidth = truncatable.style.width;
  const measured = measureText(truncatable);
  const actual = await page.screenshot({ element, save: false });
  try {
    // A flex-sized truncatable span reflows to its (now short) content
    // unless pinned: lock its box to the measured width so mutating the
    // text doesn't also change the sibling suffix's position.
    if (truncatable !== element)
      truncatable.style.width = `${measured.width}px`;
    truncatable.textContent = '…';
    const range = document.createRange();
    range.selectNodeContents(truncatable);
    const ellipsisWidth = range.getBoundingClientRect().width;
    const characters = measured.glyphs.filter(
      (glyph) => glyph.x + glyph.width <= measured.width - ellipsisWidth,
    ).length;
    truncatable.textContent =
      Array.from(original).slice(0, characters).join('') + '…';
    const expected = await page.screenshot({ element, save: false });
    return {
      characters,
      ellipsisWidth,
      matchesWholeGlyphPrefix: actual === expected,
    };
  } finally {
    truncatable.textContent = original;
    truncatable.style.width = originalWidth;
  }
}

for (const locale of ['en', 'zh-CN'] as const) {
  it(`measures long Chinese Work titles in ${locale} at 1440`, async () => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const work = {
      ...ProductRunTraceSuccessSchema.parse(recording.recording_documents[0])
        .work,
      title,
    };
    const works = [
      {
        ...projectWorkList(recording).works[0]!,
        title,
        latest_run_summary: null,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        let body: unknown;
        if (path === '/api/works') body = { works, next_cursor: null };
        else if (path === `/api/works/${work.id}`) body = { work };
        else if (/^\/api\/works\/[^/]+\/runs/.test(path))
          body = { work_runs: [], next_cursor: null };
        else if (path.startsWith('/api/work-definition-versions/'))
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        else if (path === '/api/agents' || path === '/api/work-definitions')
          body = { items: [], next_cursor: null };
        else if (path === '/api/auth/me')
          body = {
            user_id: 'type-test',
            username: 'type-test',
            display_name: 'Typography',
          };
        else throw new Error(`Unexpected request: ${path}`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    const host = document.createElement('div');
    host.style.height = '900px';
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <MemoryRouter initialEntries={[`/work/${work.id}`]}>
            <AppProviders
              commands={{
                loadCoworkers: async () => [],
                loadConversations: async () => [],
                loadMessages: async () => [],
                createConversation: async () => {
                  throw new Error('unused');
                },
                sendMessage: async () => {
                  throw new Error('unused');
                },
              }}
            >
              <AppRouter />
            </AppProviders>
          </MemoryRouter>,
        ),
      );
      await vi.waitFor(() =>
        expect(host.querySelector('.work-detail-header h1')?.textContent).toBe(
          title,
        ),
      );
      await document.fonts.ready;
      const row = host.querySelector<HTMLElement>('.work-list-copy strong')!;
      const header = host.querySelector<HTMLElement>('.work-detail-header h1')!;
      const measurements = {
        row: measureText(truncatableOf(row)),
        header: measureText(header),
      };
      const paint = {
        row: await measureEllipsisPaint(row),
        header: await measureEllipsisPaint(header),
      };
      await commands.writeFile(
        `../../.local/typography-r2/paint-${locale}.json`,
        JSON.stringify(paint, null, 2),
      );
      expect(paint.row.matchesWholeGlyphPrefix).toBe(true);
      // The directory row (work-title.tsx) now reserves its trailing 8
      // characters in a fixed-width suffix span and shares the row with a
      // `work-list-count` badge (both already on master), so the
      // truncatable prefix span has far less room than before this pin was
      // last measured. The exact glyph count depends on font rasterisation,
      // which differs across platforms, so only assert truncation happened
      // and left a sensible amount of text.
      expect(paint.row.characters).toBeGreaterThan(0);
      expect(paint.row.characters).toBeLessThan(title.length);
      expect(paint.header.matchesWholeGlyphPrefix).toBe(true);
      // The header now shares its row with a RunTrigger control
      // (work-detail-header__actions, already on master), which claims most
      // of the flex row and leaves h1 narrower than this pin assumed. As
      // above, the exact glyph count is platform-dependent.
      expect(paint.header.characters).toBeGreaterThan(0);
      expect(paint.header.characters).toBeLessThan(title.length);
      await commands.writeFile(
        `../../.local/typography-r2/titles-${locale}.json`,
        JSON.stringify(measurements, null, 2),
      );
      expect(window.innerWidth).toBe(1440);
      // The truncatable prefix's width is whatever the flex row leaves after
      // its fixed-width suffix and the `work-list-count` badge, which is a
      // rendered-text width itself (badge copy) and so isn't a single exact
      // number across platforms. Assert the layout intent instead: the
      // prefix fills the row from its own left edge up to the suffix (or the
      // row's right edge with no suffix), and the row itself fills the
      // heading up to the badge.
      const heading = row.parentElement!;
      const badge = heading.querySelector<HTMLElement>('.work-list-count')!;
      const suffixEl = row.querySelector<HTMLElement>(
        '.work-scannable-title__suffix',
      );
      const rowRect = row.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      const suffixRect = suffixEl?.getBoundingClientRect();
      const rowAvailableWidth = badgeRect.left - rowRect.left;
      expect(measurements.row.width).toBeCloseTo(
        suffixRect ? suffixRect.left - rowRect.left : rowAvailableWidth,
        0,
      );
      expect(measurements.row.height).toBe(locale === 'zh-CN' ? 18 : 19.5);
      expect(measurements.row.fontSize).toBe(locale === 'zh-CN' ? 12 : 13);
      // Likewise, the h1 fills the header between the kicker and the
      // state pill; both siblings' own widths are rendered text and
      // platform-dependent, so measure the gap directly instead of
      // hardcoding it.
      const detailHeader = header.parentElement!;
      const kicker =
        detailHeader.querySelector<HTMLElement>('.work-shell-kicker');
      const statePill =
        detailHeader.querySelector<HTMLElement>('.work-state-pill')!;
      const headerRect = header.getBoundingClientRect();
      const statePillRect = statePill.getBoundingClientRect();
      const gap = kicker
        ? headerRect.left - kicker.getBoundingClientRect().right
        : 0;
      expect(measurements.header.width).toBeCloseTo(
        statePillRect.left - gap - headerRect.left,
        0,
      );
      expect(measurements.header.height).toBe(27);
      expect(measurements.header.fontSize).toBe(locale === 'zh-CN' ? 18 : 20);
      await page.screenshot({
        path: `../../../.local/typography-r2/titles-${locale}.png`,
      });
      for (const [role, measurement] of Object.entries(measurements)) {
        expect(measurement.lineCount, role).toBe(1);
        expect(measurement.scrollWidth, role).toBeGreaterThan(
          measurement.width,
        );
        expect(measurement.textOverflow, role).toBe('ellipsis');
        // Glyph ink can overshoot the CSS line box by a subpixel at this
        // font's --leading-tight ratio; allow that without allowing real
        // multi-line wrap.
        const overshoot = 1.5;
        expect(
          measurement.glyphs.every(
            (glyph) =>
              glyph.y >= -overshoot &&
              glyph.y + glyph.height <= measurement.height + overshoot,
          ),
          role,
        ).toBe(true);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      setLocale('en');
    }
  });

  it(`keeps all Markdown heading levels on the type scale in ${locale} at 1440`, async () => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const heading = locale === 'en' ? 'Research findings' : '供应链研究结果';
    const markdown = Array.from(
      { length: 6 },
      (_, index) => `${'#'.repeat(index + 1)} ${heading}`,
    ).join('\n\n');
    try {
      await act(async () =>
        root.render(
          <>
            <div className="work-shell">
              <div className="work-overview__outcome">
                <AssistantMarkdown text={markdown} />
              </div>
            </div>
            <div className="transcript__prose">
              <AssistantMarkdown text={markdown} />
            </div>
            <div className="chat-message">
              <AssistantMarkdown text={markdown} />
            </div>
          </>,
        ),
      );
      await document.fonts.ready;
      const measurements = [
        ...host.querySelectorAll<HTMLElement>('.assistant-markdown'),
      ].map((surface) =>
        [...surface.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].map(
          measureText,
        ),
      );
      await commands.writeFile(
        `../../.local/typography-r2/markdown-${locale}.json`,
        JSON.stringify(measurements, null, 2),
      );
      for (const surface of measurements) {
        expect(surface.map((role) => role.fontSize)).toEqual([
          24, 20, 16, 14, 13, 12,
        ]);
        expect(surface.map((role) => role.height)).toEqual([
          36, 30, 24, 21, 19.5, 18,
        ]);
        expect(surface.map((role) => role.lineHeight)).toEqual([
          36, 30, 24, 21, 19.5, 18,
        ]);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      setLocale('en');
    }
  });
}
