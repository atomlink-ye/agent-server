import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import AuthPage from '../features/account/AuthPage';
import { setLocale, t } from './index';
import { measureCopy } from '../test-support/copy-measurement';
import '../index.css';

vi.mock('../features/account/account-gateway', () => ({
  login: vi
    .fn()
    .mockRejectedValue(new Error('Invalid authentication response.')),
  register: vi
    .fn()
    .mockRejectedValue(new Error('Invalid authentication response.')),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const measurements: unknown[] = [];
it.each(['en', 'zh-CN'] as const)(
  'localizes an authentication failure in %s at 1440',
  async (locale) => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <AuthPage />
          </MemoryRouter>,
        ),
      );
      await act(async () => {
        host
          .querySelector('form')!
          .dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
      });
      const alert = host.querySelector<HTMLElement>('[role=alert]')!;
      expect(alert.textContent).toBe(
        locale === 'en' ? 'Unable to authenticate.' : '无法完成身份验证。',
      );
      expect(alert.textContent).toBe(t('auth.error'));
      expect(host.textContent).not.toContain(
        'Invalid authentication response.',
      );
      measurements.push({
        locale,
        key: 'auth.error',
        ...measureCopy(alert, 'Invalid authentication response.'),
      });
      await commands.writeInventory(
        JSON.stringify({ kind: 'error-copy', measurements }),
        'canary',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      setLocale('en');
    }
  },
);
