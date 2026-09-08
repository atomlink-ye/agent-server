import { afterEach, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'agent-server.locale';

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
  vi.resetModules();
});

it('restores the saved locale when a new page evaluates the locale store', async () => {
  window.localStorage.setItem(STORAGE_KEY, 'zh-CN');
  vi.resetModules();

  const { getLocale } = await import('./index');

  expect(getLocale()).toBe('zh-CN');
});

it('persists an explicit choice even when it already matches browser detection', async () => {
  window.localStorage.setItem(STORAGE_KEY, 'zh-CN');
  vi.resetModules();

  const { setLocale } = await import('./index');
  window.localStorage.removeItem(STORAGE_KEY);
  setLocale('zh-CN');

  expect(window.localStorage.getItem(STORAGE_KEY)).toBe('zh-CN');
});
