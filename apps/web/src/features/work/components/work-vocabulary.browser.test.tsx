import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import {
  ProductRunTraceSuccessSchema,
  ProductWorkRunSuccessSchema,
} from '@atomlink-ye/agent-server/product-contract';
import { setLocale } from '../../../i18n';
import recording from '@/test-support/fixtures/product-recordings/rework-once.json';
import { WorkDetailHeader } from './work-header';
import { WorkTabs } from './work-tabs';
import '../../../index.css';
import './work-shell.css';
import './work-list.css';
import './work-detail.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    writeInventory: (
      json: string,
      target?: 'chat-surface' | 'canary',
    ) => Promise<{ path: string; bytes: number }>;
  }
}

it('keeps execution vocabulary within the desktop header in both locales', async () => {
  await page.viewport(1440, 900);
  const trace = ProductRunTraceSuccessSchema.parse(
    recording.recording_documents[0],
  );
  const run = ProductWorkRunSuccessSchema.parse({
    work: trace.work,
    work_run: trace.work_run,
    work_items: trace.work_items,
    actors: trace.actors,
    messages: trace.messages,
    projection_status: trace.projection_status,
  });
  const measurements = [];
  for (const locale of ['en', 'zh-CN'] as const) {
    setLocale(locale);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <section className="work-shell work-shell--run">
            <WorkDetailHeader work={trace.work} run={run} runOrdinal={1} />
            <WorkTabs
              activeTab="chat"
              workId={trace.work.id}
              runId={trace.work_run.id}
            />
          </section>,
        ),
      );
      const header = host.querySelector<HTMLElement>('.work-run-header')!;
      const heading = header.querySelector('h1')!;
      const tabs = host.querySelector<HTMLElement>('.work-tabs')!;
      // Replay baseline copy in the real production components; CSS is unchanged.
      const currentHeading = heading.textContent!;
      heading.textContent = locale === 'en' ? 'RUN #1' : 'RUN 第 1 次';
      const before = {
        headingWidth: heading.getBoundingClientRect().width,
        headingHeight: heading.getBoundingClientRect().height,
        headerHeight: header.getBoundingClientRect().height,
      };
      heading.textContent = currentHeading;
      const headingRect = heading.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      expect(window.innerWidth).toBe(1440);
      expect(headingRect.right).toBeLessThanOrEqual(headerRect.right);
      expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
      expect(tabs.scrollWidth).toBeLessThanOrEqual(tabs.clientWidth);
      expect(heading.textContent).toBe(
        locale === 'en' ? 'WorkRun #1' : 'WorkRun 1',
      );
      // The heading has `flex: 1` in a row of fixed-content siblings (the
      // back link, the `›` separator, the state pill), so its width is
      // whatever flex space those siblings leave rather than its own text —
      // and the siblings' own widths are rendered text, which is
      // platform-dependent. Assert the layout intent directly: measure the
      // gap from an adjacent sibling and derive the space the heading fills.
      const previousSibling = heading.previousElementSibling as HTMLElement | null;
      const nextSibling = heading.nextElementSibling as HTMLElement | null;
      const gap = previousSibling
        ? headingRect.left - previousSibling.getBoundingClientRect().right
        : 0;
      const expectedHeadingWidth = nextSibling
        ? nextSibling.getBoundingClientRect().left - gap - headingRect.left
        : headerRect.right - headingRect.left;
      expect(headingRect.width).toBeCloseTo(expectedHeadingWidth, 0);
      expect(headerRect.height).toBe(before.headerHeight);
      // The run header shares the .work-shell > .work-run-header 28px band
      // pinned in work-detail.browser.test.tsx's navigation measurements
      // (view !== 'work'); that comprehensive, cross-checked pass is the
      // canonical source, not this narrower header-only check.
      expect(headerRect.height).toBe(28);
      // 20px font-size * the shared --leading-tight (1.35) token.
      expect(headingRect.height).toBe(27);
      // Shares the .work-shell > .work-tabs band measured in
      // work-detail.browser.test.tsx's navigation pass.
      expect(tabs.getBoundingClientRect().height).toBe(26);
      measurements.push({
        locale,
        viewport: window.innerWidth,
        before,
        headerWidth: headerRect.width,
        headerHeight: headerRect.height,
        headingWidth: headingRect.width,
        headingHeight: headingRect.height,
        tabsHeight: tabs.getBoundingClientRect().height,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
      setLocale('en');
    }
  }
  await commands.writeInventory(
    JSON.stringify({ kind: 'work-vocabulary', measurements }),
    'canary',
  );
});
