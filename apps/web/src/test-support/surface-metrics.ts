import { act } from 'react';
import { expect } from 'vitest';
import { getLocale, setLocale } from '../i18n';
import '../index.css';

// Content-driven heights belong to these representative fixtures. Shared
// spacing is checked against the tokens too, so a local override cannot drift.
const heights: Record<string, Record<string, Record<string, number>>> = {
  agents: {
    en: {
      '.title-bar': 44,
      '.agents-profile-header': 90.5,
      '.agents-list-item': 57,
    },
    'zh-CN': {
      '.title-bar': 44,
      '.agents-profile-header': 90.5,
      '.agents-list-item': 57,
    },
  },
  'agents-roster': {
    en: {
      '.title-bar': 44,
      '.agents-roster-header': 59,
    },
    'zh-CN': {
      '.title-bar': 44,
      '.agents-roster-header': 59,
    },
  },
  files: {
    en: {
      '.title-bar': 44,
      '.files-files-header': 64,
      '.files-file-list button': 53,
    },
    'zh-CN': {
      '.title-bar': 44,
      '.files-files-header': 64,
      '.files-file-list button': 53,
    },
  },
  observe: {
    en: {
      '.title-bar': 44,
      '.observe-detail-header': 64,
      '.work-list-item': 90,
      '.observe-filters': 76,
    },
    'zh-CN': {
      '.title-bar': 44,
      '.observe-detail-header': 64,
      '.work-list-item': 76,
      '.observe-filters': 76,
    },
  },
  tasks: {
    en: {
      '.title-bar': 44,
      '.work-org-detail-header': 81,
      '.work-org-list-item': 90.1875,
    },
    'zh-CN': {
      '.title-bar': 44,
      '.work-org-detail-header': 81,
      '.work-org-list-item': 90.1875,
    },
  },
  boards: {
    en: {
      '.title-bar': 44,
      '.work-board-toolbar': 64,
      '.work-org-list-item': 70,
    },
    'zh-CN': {
      '.title-bar': 44,
      '.work-board-toolbar': 64,
      '.work-org-list-item': 70,
    },
  },
  whispers: {
    en: {
      '.title-bar': 44,
      'header.whisper-observer-badge': 29,
      '.whispers-list button': 57,
    },
    'zh-CN': {
      '.title-bar': 44,
      'header.whisper-observer-badge': 29,
      '.whispers-list button': 57,
    },
  },
  'run-trace-parallel': {
    en: { '.run-trace__header': 64, '.run-trace__item-row': 59 },
    'zh-CN': { '.run-trace__header': 64, '.run-trace__item-row': 59 },
  },
  'run-trace': {
    en: {
      '.run-trace__header': 64,
      '.run-trace__item-row': 105,
    },
    'zh-CN': {
      '.run-trace__header': 64,
      '.run-trace__item-row': 105,
    },
  },
  'execution-transcript': {
    en: {
      '.execution-transcript__heading': 76,
      '.execution-transcript__attempts button': 68.84375,
      '.transcript__row': 51.890625,
    },
    'zh-CN': {
      '.execution-transcript__heading': 76,
      '.execution-transcript__attempts button': 68.84375,
      '.transcript__row': 51.890625,
    },
  },
  dispatch: {
    en: {
      '.dispatch-card__event': 24,
      '.dispatch-card__status': 17,
    },
    'zh-CN': {
      '.dispatch-card__event': 24,
      '.dispatch-card__status': 17,
    },
  },
};
const styles: Record<string, Record<string, string>> = {
  '.title-bar': {
    'padding-inline-start': '--space-6',
  },
  '.work-list-item': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
    gap: '--space-3',
  },
  '.work-org-list-item': {
    padding: '--space-3',
  },
  '.agents-profile-header': {
    gap: '--space-4',
    'padding-bottom': '--space-4',
  },
  '.agents-card': {
    padding: '--space-4',
    'border-radius': '--radius-lg',
  },
  '.agents-roster-card': {
    padding: '--space-4',
    'border-radius': '--radius-lg',
  },
  '.agents-list-item': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
  },
  '.agents-main': {
    'padding-inline-start': '--space-6',
  },
  '.agents-first-screen': {
    gap: '--space-4',
  },
  '.files-file-viewer': {
    padding: '--space-4',
    'border-radius': '--radius-lg',
  },
  '.files-file-list button': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
  },
  '.files-main': {
    'padding-inline-start': '--space-6',
  },
  '.files-files-grid': {
    gap: '--space-4',
  },
  '.observe-detail': {
    padding: '--space-6',
  },
  '.observe-metric-card': {
    padding: '--space-4',
    'border-radius': '--radius-lg',
  },
  '.observe-metric-cards': {
    gap: '--space-4',
  },
  '.observe-filters': {
    'margin-inline-start': '0px',
    'margin-inline-end': '0px',
  },
  '.work-org-card': {
    padding: '--space-4',
    'border-radius': '--radius-lg',
  },
  '.work-board-card': {
    padding: '--space-4',
    'border-radius': '--radius-lg',
  },
  '.work-org-content': {
    padding: '--space-6',
  },
  '.work-org-detail-grid': {
    gap: '--space-4',
  },
  '.work-board-canvas': {
    gap: '--space-4',
  },
  '.whisper-message': {
    padding: '--space-4',
    'border-radius': '--radius-md',
  },
  '.whisper-message-log': {
    padding: '--space-6',
  },
  '.whispers-list button': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
  },
  '.run-trace__header': {
    'padding-inline-start': '--space-4',
  },
  '.run-trace__canvas': {
    padding: '--space-4',
  },
  '.execution-transcript__summary': {
    padding: '--space-4',
  },
  '.execution-transcript__detail': {
    padding: '--space-4',
  },
  '.transcript__row > summary': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
  },
  '.transcript__detail': {
    padding: '--space-3',
  },
  '.dispatch-card': {
    padding: '--space-4',
    'border-radius': '--radius-lg',
  },
  '.dispatch-card__details': {
    'margin-top': '--space-3',
    'padding-top': '--space-2',
  },
};

export async function surfaceMetrics(
  host: HTMLElement,
  surface: string,
  selectors: readonly string[],
) {
  expect(window.innerWidth).toBe(1440);
  const originalLocale = getLocale();
  const rootStyle = getComputedStyle(document.documentElement);
  try {
    for (const locale of ['en', 'zh-CN'] as const) {
      await act(async () => setLocale(locale));
      for (const selector of selectors) {
        const element = host.querySelector<HTMLElement>(selector);
        expect(element, `${surface}: ${selector}`).not.toBeNull();
        const actual = getComputedStyle(element!);
        const height = heights[surface]?.[locale]?.[selector];
        if (height !== undefined) {
          expect(
            element!.getBoundingClientRect().height,
            `${surface}/${locale}: ${selector} height`,
          ).toBeCloseTo(height, 1);
        }
        for (const [property, value] of Object.entries(
          styles[selector] ?? {},
        )) {
          const expected = value.startsWith('--')
            ? rootStyle.getPropertyValue(value).trim()
            : value;
          expect(
            actual.getPropertyValue(property),
            `${surface}/${locale}: ${selector} ${property}`,
          ).toBe(expected);
        }
      }
      if (
        surface === 'agents' ||
        surface === 'agents-roster' ||
        surface === 'files'
      ) {
        const main = host.querySelector<HTMLElement>('main')!;
        const bar = main.querySelector<HTMLElement>('.title-bar')!;
        expect(bar.getBoundingClientRect().left).toBe(
          main.getBoundingClientRect().left,
        );
        expect(bar.getBoundingClientRect().top).toBe(
          main.getBoundingClientRect().top,
        );
      }
      if (surface === 'execution-transcript') {
        const tabs = [
          ...host.querySelectorAll('.execution-transcript__attempts button'),
        ];
        for (const tab of tabs) {
          expect(tab.getBoundingClientRect().top).toBe(
            tabs[0]!.getBoundingClientRect().top,
          );
        }
      }
      if (
        surface === 'tasks' ||
        surface === 'boards' ||
        surface === 'whispers'
      ) {
        const sidebar = host.querySelector<HTMLElement>('aside.sidebar')!;
        const row = sidebar.querySelector<HTMLElement>(
          surface === 'whispers'
            ? '.whispers-list button'
            : '.work-org-list-item',
        )!;
        expect(row.getBoundingClientRect().left).toBe(
          sidebar.getBoundingClientRect().left +
            parseFloat(getComputedStyle(sidebar).paddingLeft),
        );
      }
      if (surface === 'tasks') {
        const header = host.querySelector('.work-org-detail-header')!;
        const status = header.querySelector('select')!;
        expect(status.getBoundingClientRect().width).toBeLessThanOrEqual(
          header.getBoundingClientRect().width / 2,
        );
      }
    }
  } finally {
    await act(async () => setLocale(originalLocale));
  }
}
