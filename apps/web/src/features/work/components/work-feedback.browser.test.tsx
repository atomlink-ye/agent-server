import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  ProductRunTraceSuccessSchema,
  ProductWorkRunSuccessSchema,
} from '@atomlink-ye/agent-server/product-contract';
import recording from '@/test-support/fixtures/product-recordings/rework-once.json';
import {
  projectWorkList,
  projectWorkRunList,
} from '@/test-support/product-recording-test-helpers';
import { WorkPane } from '../WorkPane';
import { WorkCard } from './WorkCard';
import { RunsPane } from './panes/runs-pane';
import { productStatePresentation } from './work-presentation';
import { useWorkCard } from '../queries/use-work-card';
import { workRunClient } from '../clients/work-run-client';
import type { WorkDetailData } from '../queries/load-work-detail';
import { setLocale, t } from '../../../i18n';
import '../../../index.css';
import './work-shell.css';
import './work-detail.css';
import './work-list.css';
import '../work-page.css';

vi.mock('../queries/use-work-card');
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const source = ProductRunTraceSuccessSchema.parse(
  recording.recording_documents[0],
);
const baseWork = projectWorkList(recording).works[0]!;
const runs = projectWorkRunList(recording, baseWork.id).work_runs;
const data: WorkDetailData = {
  work: source.work,
  runs: runs.slice(0, 1),
  run: null,
  trace: null,
  selectedDefinitionVersionId: source.work.definition_version_id,
  definitionVersion: null,
  currentDefinitionVersion: null,
};
const loadedRun = ProductWorkRunSuccessSchema.parse({
  work: source.work,
  work_run: source.work_run,
  work_items: source.work_items,
  actors: source.actors,
  messages: source.messages,
  projection_status: source.projection_status,
});
const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale('en');
});

for (const locale of ['en', 'zh-CN'] as const) {
  it.each(['report', 'identifier'] as const)(
    `${locale} long card %s keeps its condensed preview and action inside the card`,
    async (kind) => {
      await page.viewport(1440, 900);
      setLocale(locale);
      const title =
        (locale === 'en'
          ? 'Release readiness and integration review '
          : '发布就绪检查与集成评审'
        )
          .repeat(20)
          .slice(0, 192) + '20260912';
      const summary =
        kind === 'identifier'
          ? 'release_candidate_dependency_fingerprint_'.repeat(30)
          : locale === 'en'
            ? '## Release assessment\n\nThe deployment passed integration checks, but the storage migration still needs operator approval before rollout. Keep the previous image available until the regional health checks complete. '.repeat(
                15,
              )
            : '## 发布评估\n\n部署已通过集成检查，但存储迁移仍需管理员批准。请保留上一版本镜像，直到所有区域的健康检查完成。验证权限、任务恢复和故障通知后，再决定是否继续发布。'.repeat(
                20,
              );
      vi.mocked(useWorkCard).mockReturnValue({
        status: 'ready',
        card: {
          workId: baseWork.id,
          workRef: baseWork.id,
          title,
          availability: 'available',
          productState: 'needs_you',
          problemKind: null,
          attentionReason: null,
          resultSummary: summary,
          resultCaptureStatus: 'present',
        },
      });
      const host = document.createElement('div');
      host.style.width = '800px';
      document.body.append(host);
      const root = createRoot(host);
      const open = vi.fn();
      try {
        await act(async () =>
          root.render(<WorkCard workRef={baseWork.id} onOpen={open} />),
        );
        await document.fonts.ready;
        const card = host.querySelector<HTMLElement>('.work-card')!;
        const preview = host.querySelector<HTMLElement>('.work-card-result')!;
        const button = host.querySelector<HTMLButtonElement>('button')!;
        const rect = card.getBoundingClientRect();
        expect(rect.height).toBe(
          locale === 'zh-CN' && kind === 'report' ? 169 : 133,
        );
        expect(rect.width).toBe(624);
        expect(getComputedStyle(card).minHeight).toBe('124px');
        expect(preview.getBoundingClientRect().height).toBe(
          locale === 'zh-CN' && kind === 'report' ? 90 : 54,
        );
        // The preview must fill the row's remaining space next to the
        // button, not hit an exact width: that width is just the rendered
        // text width of the button's own (locale-specific) label, which
        // makes it break on any copy edit, font change, or padding tweak.
        expect(preview.getBoundingClientRect().right).toBeCloseTo(
          button.getBoundingClientRect().left - 14,
          0,
        );
        expect(button.getBoundingClientRect().height).toBe(33);
        const lastCharacter = document.createRange();
        const text = preview.firstChild!;
        lastCharacter.setStart(text, text.textContent!.length - 1);
        lastCharacter.setEnd(text, text.textContent!.length);
        expect(lastCharacter.getBoundingClientRect().right).toBeLessThanOrEqual(
          preview.getBoundingClientRect().right,
        );
        expect(
          lastCharacter.getBoundingClientRect().bottom,
        ).toBeLessThanOrEqual(preview.getBoundingClientRect().bottom);
        expect(preview.textContent!.length).toBeLessThanOrEqual(181);
        expect(preview.scrollHeight).toBe(preview.clientHeight);
        expect(preview.scrollWidth).toBe(preview.clientWidth);
        for (const element of [
          preview,
          button,
          host.querySelector<HTMLElement>('h3')!,
        ]) {
          const child = element.getBoundingClientRect();
          expect(child.bottom).toBeLessThanOrEqual(rect.bottom - 12);
          expect(child.right).toBeLessThanOrEqual(rect.right - 14);
        }
        expect(card.scrollWidth).toBe(card.clientWidth);
        await act(async () => button.click());
        expect(open).toHaveBeenCalledWith(baseWork.id);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it.each(['empty', 'offline', 'stale'] as const)(
    `${locale} directory %s preserves feedback and recovers with the pane as scroll owner`,
    async (state) => {
      await page.viewport(1440, 900);
      setLocale(locale);
      let offline = state === 'offline';
      const works = Array.from({ length: 30 }, (_, i) => ({
        ...baseWork,
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      }));
      let populated = state === 'stale';
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === '/api/works') {
          if (offline) throw new TypeError('private offline diagnostic');
          return json({ works: populated ? works : [], next_cursor: null });
        }
        if (path.endsWith('/runs'))
          return json({ work_runs: [], next_cursor: null });
        return json({ items: [], next_cursor: null });
      });
      vi.stubGlobal('fetch', fetchMock);
      const host = document.createElement('div');
      host.className = 'app-shell';
      document.body.append(host);
      const root = createRoot(host);
      const create = vi.fn();
      try {
        await act(async () =>
          root.render(
            <MemoryRouter>
              <div />
              <WorkPane onCreateNew={create} />
              <main />
            </MemoryRouter>,
          ),
        );
        const refresh = [
          ...host.querySelectorAll<HTMLButtonElement>('button'),
        ].find(
          (button) => button.getAttribute('aria-label') === t('work.refresh'),
        )!;
        if (state === 'stale') {
          offline = true;
          await act(async () => refresh.click());
        }
        const feedback = host.querySelector<HTMLElement>(
          `[data-testid="work-list-${state === 'empty' ? 'empty' : 'error'}"]`,
        )!;
        const action = feedback.querySelector<HTMLButtonElement>('button')!;
        const pane = host.querySelector<HTMLElement>(
          '.work-pane-scroll.scroll-region',
        )!;
        // 96, not 90: the placeholder sits flush against `.work-pane-scroll`,
        // whose top is pinned at 96 in work-list.browser.test.tsx's
        // "measures ... directory density and long titles" pass — that
        // broader, cross-checked measurement is the canonical source.
        expect(feedback.getBoundingClientRect().top).toBe(
          locale === 'zh-CN' ? 93 : 96,
        );
        expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(
          32,
        );
        expect(action.getBoundingClientRect().height).toBeLessThanOrEqual(35);
        expect(feedback.textContent).toContain(
          t(
            state === 'empty'
              ? 'work.empty'
              : state === 'stale'
                ? 'work.staleList'
                : 'work.connectionProblem',
          ),
        );
        expect(feedback.getBoundingClientRect().height).toBe(220);
        // The sidebar column's available width shifts by the platform's
        // scrollbar width (macOS overlay scrollbars take no layout space;
        // Linux CI's classic scrollbar does), so the placeholder — meant to
        // fill `.work-pane-scroll` — can't be pinned to one exact number on
        // both platforms. Assert the intent instead: see the identical fix
        // in work-list.browser.test.tsx.
        expect(feedback.getBoundingClientRect().width).toBeCloseTo(
          pane.clientWidth,
          0,
        );
        expect(action.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          feedback.getBoundingClientRect().bottom,
        );
        expect(host.textContent).not.toContain('private offline diagnostic');
        if (state === 'empty') {
          await act(async () => action.click());
          expect(create).toHaveBeenCalledOnce();
        }
        offline = false;
        populated = true;
        await act(async () => (state === 'empty' ? refresh : action).click());
        const list = host.querySelector<HTMLElement>(
          '[data-testid="work-list"]',
        )!;
        expect(
          host.querySelector('[data-testid="work-list-error"]'),
        ).toBeNull();
        expect(list.children).toHaveLength(30);
        expect(getComputedStyle(list).overflowY).toBe('visible');
        expect(getComputedStyle(pane).overflowY).toBe('auto');
        expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight);
        // 788, not 794: matches the `.work-pane-scroll` height pinned in
        // work-list.browser.test.tsx's "measures ... directory density and
        // long titles" pass.
        expect(pane.getBoundingClientRect().height).toBe(
          locale === 'zh-CN' ? 791 : 788,
        );
        pane.scrollTop = pane.scrollHeight;
        expect(pane.scrollTop).toBeGreaterThan(0);
        const last = list.lastElementChild!.getBoundingClientRect();
        expect(last.bottom).toBeLessThanOrEqual(
          pane.getBoundingClientRect().bottom,
        );
        expect(last.top).toBeGreaterThanOrEqual(
          pane.getBoundingClientRect().top,
        );
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it(`${locale} failed Run state read has retry without moving the row`, async () => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const get = vi
      .spyOn(workRunClient, 'get')
      .mockRejectedValue(new Error('private Run diagnostic'));
    const host = document.createElement('div');
    host.className = 'app-shell';
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <div />
            <aside />
            <main className="work-main">
              <div className="work-shell">
                <RunsPane data={data} />
              </div>
            </main>
          </MemoryRouter>,
        ),
      );
      const row = host.querySelector<HTMLElement>('.work-run-list > li')!;
      expect(row.getBoundingClientRect().height).toBe(78);
      expect(row.getBoundingClientRect().width).toBe(964);
      expect(row.textContent).toContain(t('work.run.stateError'));
      const before = row.getBoundingClientRect();
      expect(row.textContent).not.toContain('private Run diagnostic');
      const retry = row.querySelector<HTMLButtonElement>('button');
      expect(retry).not.toBeNull();
      expect(retry!.textContent).toBe(t('work.retry'));
      get.mockResolvedValue(loadedRun);
      await act(async () => retry!.click());
      expect(get).toHaveBeenCalledTimes(2);
      expect(get).toHaveBeenLastCalledWith(
        data.runs[0]!.work_id,
        data.runs[0]!.id,
      );
      expect(row.querySelector('button')).toBeNull();
      expect(row.querySelector('.work-state-pill')?.textContent).toBe(
        productStatePresentation(loadedRun.work_run.product_state).label,
      );
      expect(row.getBoundingClientRect().height).toBe(before.height);
      expect(
        row.querySelector('a')!.getBoundingClientRect().bottom,
      ).toBeLessThanOrEqual(row.getBoundingClientRect().bottom);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
}
