import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { getLocale, setLocale } from '@/i18n';
import { assertSurfaceContract } from '@/test-support/surface-contract';
import { parseRecordedTrace } from '@/test-support/run-trace-recording-test-helpers';
import parallelRecording from '@/test-support/fixtures/product-recordings/parallel-success.json';
import '@/index.css';
import { RunTrace } from './run-trace-view';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('shares root surface tokens across rendered Trace inspector tabs', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const originalLocale = getLocale();
  try {
    await act(async () => {
      root.render(<RunTrace trace={parseRecordedTrace(parallelRecording)} />);
    });
    for (const locale of ['en', 'zh-CN'] as const) {
      await act(async () => setLocale(locale));
      for (const mode of ['Conversation', 'Activity']) {
        const tab = [
          ...host.querySelectorAll<HTMLButtonElement>(
            '.run-trace__inspector-tabs button',
          ),
        ].find((button) => button.textContent?.trim() === mode);
        expect(tab).toBeDefined();
        await act(async () => tab!.click());
        expect(
          host.querySelectorAll('.run-trace__detail-disclosure'),
        ).toHaveLength(1);
        await assertSurfaceContract(host, 'trace', locale, mode.toLowerCase());
      }
    }
  } finally {
    await act(async () => {
      root.unmount();
      setLocale(originalLocale);
    });
    host.remove();
  }
});
