import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import * as chatApi from '../../conversations/conversations-gateway';
import { WorkCard } from './WorkCard';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const workId = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('refreshes a live Work Card and stops polling once the Work becomes terminal', async () => {
  vi.useFakeTimers();
  const load = vi.spyOn(chatApi, 'loadWorkCard');
  load
    .mockResolvedValueOnce(card('running', null))
    .mockResolvedValueOnce(card('complete', 'Research complete.'));

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<WorkCard workRef={workId} onOpen={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Running');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Complete');
    expect(host.textContent).toContain('Research complete.');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

function card(
  state: 'running' | 'complete',
  resultSummary: string | null,
): chatApi.WorkChatCard {
  return {
    workId,
    workRef: workId,
    title: 'Competitor Research',
    availability: 'available',
    productState: state,
    problemKind: null,
    attentionReason: null,
    resultSummary,
    resultCaptureStatus: resultSummary ? 'present' : 'not_present',
  };
}
