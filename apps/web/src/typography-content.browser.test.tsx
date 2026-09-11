import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
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

function measureText(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const text = element.firstChild!;
  let offset = 0;
  const glyphs = Array.from(element.textContent!).map((character) => {
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

// Compare native ellipsis paint with a prefix ending at a whole-character
// boundary. Range boxes alone include elided text and cannot prove paint.
async function measureEllipsisPaint(element: HTMLElement) {
  const original = element.textContent!;
  const measured = measureText(element);
  const actual = await page.screenshot({ element, save: false });
  try {
    element.textContent = '…';
    const range = document.createRange();
    range.selectNodeContents(element);
    const ellipsisWidth = range.getBoundingClientRect().width;
    const characters = measured.glyphs.filter(
      (glyph) => glyph.x + glyph.width <= measured.width - ellipsisWidth,
    ).length;
    element.textContent =
      Array.from(original).slice(0, characters).join('') + '…';
    const expected = await page.screenshot({ element, save: false });
    return {
      characters,
      ellipsisWidth,
      matchesWholeGlyphPrefix: actual === expected,
    };
  } finally {
    element.textContent = original;
  }
}

for (const locale of ['en', 'zh-CN'] as const) {
  it(`measures long Chinese Work titles in ${locale} at 1440`, async () => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const work = { ...recording.recording_documents[0]!.work, title };
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
        row: measureText(row),
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
      expect(paint.row.characters).toBe(17);
      expect(paint.header.matchesWholeGlyphPrefix).toBe(true);
      expect(paint.header.characters).toBe(locale === 'en' ? 9 : 15);
      await commands.writeFile(
        `../../.local/typography-r2/titles-${locale}.json`,
        JSON.stringify(measurements, null, 2),
      );
      expect(window.innerWidth).toBe(1440);
      expect(measurements.row.width).toBe(236);
      expect(measurements.row.height).toBe(19.5);
      expect(measurements.row.fontSize).toBe(13);
      expect(measurements.header.width).toBe(
        locale === 'en' ? 207.15625 : 314.734375,
      );
      expect(measurements.header.height).toBe(27);
      expect(measurements.header.fontSize).toBe(20);
      await page.screenshot({
        path: `../../../.local/typography-r2/titles-${locale}.png`,
      });
      for (const [role, measurement] of Object.entries(measurements)) {
        expect(measurement.lineCount, role).toBe(1);
        expect(measurement.scrollWidth, role).toBeGreaterThan(
          measurement.width,
        );
        expect(measurement.textOverflow, role).toBe('ellipsis');
        expect(
          measurement.glyphs.every(
            (glyph) =>
              glyph.y >= 0 && glyph.y + glyph.height <= measurement.height,
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
