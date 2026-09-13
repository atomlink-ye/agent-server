import { afterEach, expect, it } from 'vitest';

import { getLocale, setLocale } from '../../../i18n';
import { formatWorkListTime, startedWorkRunHref } from './work-presentation';

afterEach(() => {
  setLocale('en');
});

it('formats Work-list timestamps with the app locale', () => {
  setLocale('zh-CN');

  expect(getLocale()).toBe('zh-CN');
  expect(formatWorkListTime('2026-08-16T10:00:00.000Z')).toMatch(/[月日]/u);
});

it('opens a newly started WorkRun on observable Activity', () => {
  expect(startedWorkRunHref('work-1', 'run-1')).toBe(
    '/work/work-1?tab=transcript&run=run-1',
  );
  const withOrigin = new URL(
    startedWorkRunHref('work-1', 'run-1', 'conversation-1'),
    'http://agent-server.test',
  );
  expect(withOrigin.pathname).toBe('/work/work-1');
  expect(Object.fromEntries(withOrigin.searchParams)).toEqual({
    from_conversation: 'conversation-1',
    tab: 'transcript',
    run: 'run-1',
  });
});
