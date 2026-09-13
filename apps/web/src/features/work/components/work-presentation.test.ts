import { afterEach, expect, it } from 'vitest';

import { getLocale, setLocale } from '../../../i18n';
import { formatWorkListTime, workTabHref } from './work-presentation';

afterEach(() => {
  setLocale('en');
});

it('formats Work-list timestamps with the app locale', () => {
  setLocale('zh-CN');

  expect(getLocale()).toBe('zh-CN');
  expect(formatWorkListTime('2026-08-16T10:00:00.000Z')).toMatch(/[月日]/u);
});

it('opens a selected WorkRun on its visible output instead of empty chat', () => {
  expect(workTabHref('work-1', 'overview', 'run-1')).toBe(
    '/work/work-1?tab=result&run=run-1',
  );
});
