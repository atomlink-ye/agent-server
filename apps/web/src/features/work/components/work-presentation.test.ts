import { afterEach, expect, it } from 'vitest';

import { getLocale, setLocale } from '../../../i18n';
import { formatWorkListTime } from './work-presentation';

afterEach(() => {
  setLocale('en');
});

it('formats Work-list timestamps with the app locale', () => {
  setLocale('zh-CN');

  expect(getLocale()).toBe('zh-CN');
  expect(formatWorkListTime('2026-08-16T10:00:00.000Z')).toMatch(/[月日]/u);
});
