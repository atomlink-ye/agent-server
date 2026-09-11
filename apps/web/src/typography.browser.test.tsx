import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { page, commands } from 'vitest/browser';
import { AppProviders } from './app/providers';
import { AppRouter } from './app/router';
import { setLocale } from './i18n';
import recording from './test-support/fixtures/product-recordings/parallel-success.json';
import { projectWorkList } from './test-support/product-recording-test-helpers';
import './index.css';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const selectors = [
  '.rail-brand',
  '.rail-language-button',
  '.pane-heading h1',
  '.pane-heading .eyebrow',
  '.pane-count',
  '.pane-refresh',
  '.work-list-copy strong',
  '.work-list-meta',
  '.work-list-mark',
  '.title-bar',
  '.work-landing__intro .eyebrow',
  '.work-landing__intro h1',
  '.work-landing__intro > p:not(.eyebrow)',
  '.work-landing__recent strong',
  '.work-landing__recent time',
  '.work-landing__no-run',
];

const expectedRoles: Record<string, readonly [number, number]> = {
  '.rail-brand': [20.0, 30.0],
  '.rail-language-button': [12.0, 12.0],
  '.pane-heading h1': [20.0, 30.0],
  '.pane-heading .eyebrow': [12.0, 18.0],
  '.pane-count': [12.0, 18.0],
  '.pane-refresh': [20.0, 30.0],
  '.work-list-copy strong': [13.0, 19.5],
  '.work-list-meta': [12.0, 18.0],
  '.work-list-mark': [12.0, 18.0],
  '.title-bar': [12.0, 18.0],
  '.work-landing__intro .eyebrow': [12.0, 18.0],
  '.work-landing__intro h1': [24.0, 36.0],
  '.work-landing__intro > p:not(.eyebrow)': [13.0, 20.8],
  '.work-landing__recent strong': [16.0, 24.0],
  '.work-landing__recent time': [12.0, 18.0],
  '.work-landing__no-run': [12.0, 18.0],
};

for (const locale of ['en', 'zh-CN'] as const) {
  it(`measures readable typography and Work directory density in ${locale} at 1440`, async () => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const base = projectWorkList(recording).works[0]!;
    const works = Array.from({ length: 48 }, (_, index) => ({
      ...base,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title:
        locale === 'en'
          ? `Review research ${index + 1}`
          : `审查研究结果 ${index + 1}`,
      latest_run_summary: null,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        let body: unknown;
        if (path === '/api/works') body = { works, next_cursor: null };
        else if (/^\/api\/works\/[^/]+\/runs/.test(path))
          body = { work_runs: [], next_cursor: null };
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
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/work']}>
            <AppProviders
              commands={{
                loadCoworkers: async () => [],
                loadConversations: async () => [],
                createConversation: async () => {
                  throw new Error('unused');
                },
                loadMessages: async () => [],
                sendMessage: async () => {
                  throw new Error('unused');
                },
              }}
            >
              <AppRouter />
            </AppProviders>
          </MemoryRouter>,
        );
      });
      await vi.waitFor(() =>
        expect(host.querySelectorAll('.work-list-item')).toHaveLength(48),
      );
      await document.fonts.ready;
      const roles = selectors.map((selector) => {
        const element = host.querySelector<HTMLElement>(selector);
        expect(element, selector).not.toBeNull();
        const style = getComputedStyle(element!);
        const range = document.createRange();
        range.selectNodeContents(element!);
        // CSSOM preserves the keyword 'normal'; a two-line probe resolves its
        // actual line advance in this browser and installed font stack.
        const probe = document.createElement('div');
        Object.assign(probe.style, {
          position: 'absolute',
          visibility: 'hidden',
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          whiteSpace: 'pre',
        });
        probe.textContent = '审查 Ag\n审查 Ag';
        document.body.append(probe);
        const lineBox = probe.getBoundingClientRect().height / 2;
        probe.remove();
        return {
          selector,
          px: style.fontSize,
          leading: style.lineHeight,
          lineBox,
          glyphHeight: range.getBoundingClientRect().height,
        };
      });
      expect(window.innerWidth).toBe(1440);
      expect(document.documentElement.lang).toBe(locale);
      for (const role of roles) {
        const [size, leading] = expectedRoles[role.selector]!;
        expect(parseFloat(role.px), role.selector).toBe(size);
        expect(parseFloat(role.leading), role.selector).toBeCloseTo(leading, 2);
        expect(role.lineBox, role.selector).toBeCloseTo(leading, 1);
      }
      for (const element of host.querySelectorAll<HTMLElement>('*')) {
        const hasText = [...element.childNodes].some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        if (hasText && element.getBoundingClientRect().height > 1) {
          expect(
            parseFloat(getComputedStyle(element).fontSize),
            element.className,
          ).toBeGreaterThanOrEqual(12);
        }
      }
      const scroller = host.querySelector<HTMLElement>('.work-pane-scroll')!;
      const bounds = scroller.getBoundingClientRect();
      const rows = [...host.querySelectorAll<HTMLElement>('.work-list-item')];
      const visible = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      }).length;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      const family = getComputedStyle(rows[0]!).fontFamily;
      const glyphs = [9, 10, 11, 12, 13].map((px) => {
        context.font = `${px}px ${family}`;
        const metrics = context.measureText('审查研究结果');
        return {
          px,
          width: metrics.width,
          inkHeight:
            metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        };
      });
      expect(glyphs.find((glyph) => glyph.px === 12)!.width).toBe(72);
      expect(
        glyphs.find((glyph) => glyph.px === 12)!.inkHeight,
      ).toBeGreaterThan(glyphs.find((glyph) => glyph.px === 9)!.inkHeight);
      await commands.writeFile(
        `../../.local/typography/${locale}.json`,
        JSON.stringify({
          locale,
          roles,
          glyphs,
          density: {
            rowHeight: rows[0]!.getBoundingClientRect().height,
            visible,
            scrollerHeight: bounds.height,
            scrollerTop: bounds.top,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          },
        }),
      );
      expect(rows[0]!.getBoundingClientRect().height).toBeCloseTo(49.5, 1);
      expect(visible).toBe(14);
      expect(bounds.height).toBeCloseTo(788, 1);
      expect(bounds.top).toBeCloseTo(96, 1);
      expect(scroller.scrollHeight).toBe(2647);
      const rowStyle = getComputedStyle(rows[0]!);
      expect(rowStyle.paddingTop).toBe('4px');
      expect(rowStyle.paddingBottom).toBe('4px');
      expect(
        getComputedStyle(rows[0]!.querySelector('.work-list-copy')!).gap,
      ).toBe('2px');
      const list = host.querySelector<HTMLElement>(
        '.work-pane-scroll > .work-list',
      )!;
      expect(getComputedStyle(list).overflowY).toBe('visible');
      expect(list.scrollHeight).toBe(list.clientHeight);
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      scroller.scrollTop = scroller.scrollHeight;
      expect(rows.at(-1)!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        bounds.bottom + 1,
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      setLocale('en');
    }
  });
}
