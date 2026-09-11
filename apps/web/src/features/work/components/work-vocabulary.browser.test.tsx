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
  const run = ProductWorkRunSuccessSchema.parse(trace);
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
      expect(headingRect.width).toBeCloseTo(
        locale === 'en' ? 103.484375 : 91.890625,
        1,
      );
      expect(headerRect.height).toBe(before.headerHeight);
      expect(headerRect.height).toBe(36);
      expect(headingRect.height).toBe(24);
      expect(tabs.getBoundingClientRect().height).toBe(34);
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
