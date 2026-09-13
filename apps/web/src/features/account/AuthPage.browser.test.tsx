import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../index.css';
import { setLocale, t } from '../../i18n';
import AuthPage from './AuthPage';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  setLocale('en');
});

it.each(['en', 'zh-CN'] as const)(
  'keeps the account card and controls readable at 1440 in %s',
  async (locale) => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/login']}>
            <AuthPage />
          </MemoryRouter>,
        );
      });
      await document.fonts.ready;

      const card = host.querySelector<HTMLElement>('.auth-card')!;
      const controls = [...card.querySelectorAll<HTMLElement>('input, button')];
      expect(card.getBoundingClientRect().width).toBe(380);
      expect(card.scrollWidth).toBe(card.clientWidth);
      expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(900);
      for (const control of controls) {
        expect(
          parseFloat(getComputedStyle(control).fontSize),
        ).toBeGreaterThanOrEqual(12);
        expect(control.scrollWidth).toBeLessThanOrEqual(
          control.clientWidth + 1,
        );
      }
      expect(
        controls[0]!.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(40);
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it.each(['en', 'zh-CN'] as const)(
  'replaces the account busy state with a localized error in %s',
  async (locale) => {
    setLocale(locale);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/login']}>
            <AuthPage />
          </MemoryRouter>,
        );
      });
      const form = host.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        t('auth.error'),
      );
      expect(host.textContent).not.toContain(t('auth.working'));
    } finally {
      await act(async () => root.unmount());
    }
  },
);
