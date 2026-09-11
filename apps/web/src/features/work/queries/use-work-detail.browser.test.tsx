import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkDetail } from './use-work-detail';
import { loadWorkDetail } from './load-work-detail';
import { ProductReadError } from '../clients/errors';
vi.mock('./load-work-detail');
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function Probe() {
  const query = useWorkDetail({
    workId: '11111111-1111-4111-8111-111111111111',
    preferCurrentDefinition: true,
    includeTrace: false,
  });
  return <output data-status={query.status} />;
}
it.each([
  [503, 'feature_unavailable', 'error', 1],
  [503, null, 'starting', 2],
  [403, null, 'error', 1],
] as const)(
  'classifies status %s / %s without endless false starting',
  async (status, code, expected, calls) => {
    vi.useFakeTimers();
    vi.mocked(loadWorkDetail).mockRejectedValue(
      new ProductReadError('private backend detail', status, code),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<Probe />);
      });
      expect(host.querySelector('output')?.dataset.status).toBe(expected);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(loadWorkDetail).toHaveBeenCalledTimes(calls);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
