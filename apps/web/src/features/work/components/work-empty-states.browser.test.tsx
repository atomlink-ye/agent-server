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
import { parseRecordedTrace } from '@/test-support/run-trace-recording-test-helpers';
import { ArtifactsPane } from './panes/artifacts-pane';
import { RunsPane } from './panes/runs-pane';
import { TranscriptPane } from './panes/transcript-pane';
import type { WorkDetailData } from '../queries/load-work-detail';
import { setLocale, t } from '../../../i18n';
import '../../../index.css';
import './work-shell.css';
import './work-detail.css';
import './work-list.css';
import '../work-page.css';
vi.mock('../queries/use-run-availability', () => ({
  useRunAvailability: () => ({
    status: 'ready',
    missingCapability: null,
    retry: vi.fn(),
  }),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const source = ProductRunTraceSuccessSchema.parse(
  recording.recording_documents[0],
);
const data: WorkDetailData = {
  work: source.work,
  runs: [],
  run: null,
  trace: null,
  selectedDefinitionVersionId: source.work.definition_version_id,
  definitionVersion: null,
  currentDefinitionVersion: null,
};
const withTrace: WorkDetailData = {
  ...data,
  trace: parseRecordedTrace(recording),
  run: ProductWorkRunSuccessSchema.parse({
    work: source.work,
    work_run: source.work_run,
    work_items: source.work_items,
    actors: source.actors,
    messages: source.messages,
    projection_status: source.projection_status,
  }),
};
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('en');
});
for (const locale of ['en', 'zh-CN'] as const) {
  it.each(['runs', 'artifacts', 'transcript'] as const)(
    `${locale} empty %s gives a next action`,
    async (state) => {
      await page.viewport(1440, 900);
      setLocale(locale);
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () => {
          root.render(
            <MemoryRouter>
              <div className="work-shell">
                {state === 'runs' ? (
                  <RunsPane data={data} />
                ) : state === 'artifacts' ? (
                  <ArtifactsPane workId={data.work.id} />
                ) : (
                  <TranscriptPane data={data} />
                )}
              </div>
            </MemoryRouter>,
          );
        });
        expect(host.textContent).toContain(
          t(
            state === 'runs'
              ? 'work.scope.emptyTitle'
              : state === 'artifacts'
                ? 'work.artifacts.emptyTitle'
                : 'work.transcript.emptyTitle',
          ),
        );
        const action = host.querySelector<HTMLElement>('a,button')!;
        const surface = host.querySelector<HTMLElement>(
          '.work-shell > section',
        )!;
        expect(surface.getBoundingClientRect().height).toBe(
          state === 'runs' ? 143.1875 : 169.1875,
        );
        expect(surface.getBoundingClientRect().width).toBe(760);
        expect(action).not.toBeNull();
        expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(1440);
        expect(action.getAttribute('href')).toBe(
          `/work/${data.work.id}?tab=${state === 'runs' ? 'chat' : 'runs'}`,
        );
        if (state === 'runs') {
          expect(action.textContent).toBe(t('work.record.preparation'));
          expect(host.querySelector('button')).toBeNull();
        }
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
  it.each(['loading', 'empty', 'error'] as const)(
    `${locale} recorded transcript %s offers navigation and refresh`,
    async (state) => {
      await page.viewport(1440, 900);
      setLocale(locale);
      const fetchMock = vi.fn(async () =>
        state === 'loading'
          ? new Promise<Response>(() => {})
          : ({
              ok: state !== 'error',
              status: state === 'error' ? 500 : 200,
              json: async () => ({
                work_id: data.work.id,
                work_run_id: source.work_run.id,
                capture_scope: 'safe_run_events',
                sessions: [],
              }),
            } as Response),
      );
      vi.stubGlobal('fetch', fetchMock);
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () => {
          root.render(
            <MemoryRouter>
              <div className="work-shell">
                <TranscriptPane data={withTrace} />
              </div>
            </MemoryRouter>,
          );
        });
        expect(host.textContent).toContain(
          t(
            state === 'loading'
              ? 'trace.sessions.loading'
              : state === 'empty'
                ? 'trace.sessions.empty'
                : 'trace.sessions.unavailable',
          ),
        );
        const transcript = host.querySelector<HTMLElement>(
          '.execution-transcript',
        )!;
        expect(transcript.getBoundingClientRect().height).toBe(112);
        expect(
          host.querySelector('.work-shell')!.getBoundingClientRect().height,
        ).toBe(400);
        if (state === 'loading') {
          const animation = transcript.getAnimations()[0]!;
          animation.pause();
          animation.currentTime = 100;
          expect(getComputedStyle(transcript).visibility).toBe('hidden');
          animation.currentTime = 150;
          expect(getComputedStyle(transcript).visibility).toBe('visible');
        }
        const back = host.querySelector('a')!;
        expect(back.getAttribute('href')).toBe(
          `/work/${data.work.id}?tab=runs`,
        );
        const refresh = host.querySelector<HTMLButtonElement>('button')!;
        expect(refresh.textContent).toBe(t('work.refreshTranscript'));
        const top = refresh.getBoundingClientRect().top;
        await act(async () => {
          refresh.click();
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(host.querySelector('button')!.getBoundingClientRect().top).toBe(
          top,
        );
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
}
