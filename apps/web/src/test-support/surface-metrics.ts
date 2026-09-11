import { assertSurfaceContract, type Surface } from './surface-contract';
import { act } from 'react';
import { expect } from 'vitest';
import { getLocale, setLocale } from '../i18n';
import '../index.css';

// Content-driven heights belong to these representative fixtures. Shared
// spacing is checked against the tokens too, so a local override cannot drift.
const heights: Record<string, Record<string, Record<string, number>>> = {
  agents: {
    en: {
      '.agents-profile-header': 90.5,
      '.agents-list-item': 57,
    },
    'zh-CN': {
      '.agents-profile-header': 90.5,
      '.agents-list-item': 57,
    },
  },
  'agents-roster': {
    en: {
      '.agents-roster-header': 59,
    },
    'zh-CN': {
      '.agents-roster-header': 59,
    },
  },
  files: {
    en: {
      '.files-files-header': 64,
      '.files-file-list button': 53,
    },
    'zh-CN': {
      '.files-files-header': 64,
      '.files-file-list button': 53,
    },
  },
  observe: {
    en: {
      '.observe-detail-header': 64,
      '.work-list-item': 90,
      '.observe-filters': 76,
    },
    'zh-CN': {
      '.observe-detail-header': 64,
      '.work-list-item': 76,
      '.observe-filters': 76,
    },
  },
  tasks: {
    en: {
      '.work-org-detail-header': 81,
      '.work-org-list-item': 90.1875,
    },
    'zh-CN': {
      '.work-org-detail-header': 81,
      '.work-org-list-item': 90.1875,
    },
  },
  boards: {
    en: {
      '.work-board-toolbar': 64,
      '.work-org-list-item': 70,
    },
    'zh-CN': {
      '.work-board-toolbar': 64,
      '.work-org-list-item': 70,
    },
  },
  whispers: {
    en: {
      '.whispers-list button': 57,
    },
    'zh-CN': {
      '.whispers-list button': 57,
    },
  },
  'run-trace-parallel': {
    en: { '.run-trace__item-row': 59 },
    'zh-CN': { '.run-trace__item-row': 59 },
  },
  'run-trace': {
    en: {
      '.run-trace__item-row': 105,
    },
    'zh-CN': {
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
// Content rows and section headings are distinct from the shared surface
// roles. Only these fixture-specific details remain here; the cross-surface
// geometry and tokens have one authority in surface-contract.ts.
const styles: Record<string, Record<string, string>> = {
  '.work-list-item': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
    gap: '--space-3',
  },
  '.work-org-list-item': { padding: '--space-3' },
  '.agents-profile-header': { gap: '--space-4', 'padding-bottom': '--space-4' },
  '.agents-list-item': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
  },
  '.files-file-list button': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
  },
  '.observe-filters': {
    'margin-inline-start': '0px',
    'margin-inline-end': '0px',
  },
  '.whispers-list button': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
  },
  '.transcript__row > summary': {
    'padding-block-start': '--space-2',
    'padding-inline-start': '--space-3',
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
      const names: Surface[] =
        surface === 'execution-transcript'
          ? ['sessions', 'stream']
          : surface.startsWith('run-trace')
            ? ['trace']
            : [surface as Surface];
      for (const name of names) await assertSurfaceContract(host, name, locale);
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
