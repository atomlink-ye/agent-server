import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { WorkCard } from './WorkCard';
import { useWorkCard } from '../queries/use-work-card';
import { setLocale, t } from '../../../i18n';
import '../../../index.css';
vi.mock('../queries/use-work-card');
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const workId = '11111111-1111-4111-8111-111111111111';
for (const locale of ['en', 'zh-CN'] as const) {
  it.each(['loading', 'error', 'ready'] as const)(
    `${locale} card %s holds geometry and offers a way into Work`,
    async (state) => {
      await page.viewport(1440, 900);
      setLocale(locale);
      const host = document.createElement('div');
      host.style.width = '800px';
      document.body.append(host);
      const root = createRoot(host);
      const title =
        locale === 'en' ? 'A'.repeat(199) + 'B' : '中'.repeat(199) + '文';
      vi.mocked(useWorkCard).mockReturnValue(
        state === 'ready'
          ? {
              status: 'ready',
              card: {
                workId,
                workRef: workId,
                title,
                availability: 'available',
                productState: 'problem',
                problemKind: null,
                attentionReason: null,
                resultSummary: null,
                resultCaptureStatus: 'not_present',
              },
            }
          : { status: state },
      );
      const open = vi.fn();
      try {
        await act(async () => {
          root.render(<WorkCard workRef={workId} onOpen={open} />);
        });
        const card = host.querySelector<HTMLElement>('.work-card')!;
        expect(card.getBoundingClientRect().height).toBe(124);
        expect(card.getBoundingClientRect().width).toBe(624);
        expect(card.scrollWidth).toBe(card.clientWidth);
        if (state === 'loading') {
          const feedback = card.querySelector<HTMLElement>(
            '.work-loading-feedback',
          )!;
          const animation = feedback.getAnimations()[0]!;
          animation.pause();
          animation.currentTime = 100;
          expect(getComputedStyle(feedback).visibility).toBe('hidden');
          animation.currentTime = 150;
          expect(getComputedStyle(feedback).visibility).toBe('visible');
        }
        if (state !== 'loading') {
          await act(async () => {
            host.querySelector<HTMLButtonElement>('button')!.click();
          });
          expect(open).toHaveBeenCalledWith(workId);
          expect(card.textContent).toContain(t('workCard.open'));
        }
        if (state === 'ready') {
          expect(
            host.querySelector('.work-scannable-title')?.getAttribute('title'),
          ).toBe(title);
          expect(
            host.querySelector('.work-scannable-title__suffix')?.textContent,
          ).toBe(title.slice(-8));
          expect(host.querySelector('.work-status')?.textContent).toContain(
            '!',
          );
        }
      } finally {
        await act(async () => root.unmount());
        host.remove();
        setLocale('en');
      }
    },
  );
}
