import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { WorkListShell } from '@/components/work/work-shell';
import parallelRecording from '@/lib/__fixtures__/product-recordings/parallel-success-fa77ba9.json';
import reworkRecording from '@/lib/__fixtures__/product-recordings/rework-once-fa77ba9.json';
import { projectWorkList } from '@/lib/product-recording-projections';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const parallelWorkList = projectWorkList(parallelRecording);
const reworkWorkList = projectWorkList(reworkRecording);
const populatedWorkList = {
  ...parallelWorkList,
  works: [...parallelWorkList.works, ...reworkWorkList.works],
};
const emptyWorkList = { ...parallelWorkList, works: [] };

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderedStatusSemantics(host: HTMLElement): string {
  return [...host.querySelectorAll<HTMLElement>('*')]
    .flatMap((element) => [
      element.className,
      element.getAttribute('aria-label') ?? '',
      element.getAttribute('data-state') ?? '',
    ])
    .join(' ');
}

async function settleNetworkTurn() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it(
  'renders both recorder-backed Work titles and exact detail links without N+1 reads',
  async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe('/api/works');
        expect(init?.method).toBe('GET');
        return jsonResponse(populatedWorkList);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<WorkListShell />);
        await Promise.resolve();
      });

      const cards = [
        ...host.querySelectorAll<HTMLLIElement>('.work-list-card'),
      ];
      expect(cards).toHaveLength(populatedWorkList.works.length);
      for (const [index, work] of populatedWorkList.works.entries()) {
        const card = cards[index];
        expect(card).toBeDefined();
        if (!card) continue;

        const link = card.querySelector<HTMLAnchorElement>('a');
        expect(link?.textContent).toBe(work.title);
        expect(link?.getAttribute('href')).toBe(`/works/${work.id}`);
        expect(card.textContent).toContain(
          'Product status is currently unavailable for this Work.',
        );
        expect(
          card.querySelector('.work-list-card__unavailable'),
        ).not.toBeNull();
      }

      expect(host.textContent).not.toMatch(
        /Needs You|Problem|Failed|Stuck|Completed|已完成/,
      );
      expect(renderedStatusSemantics(host)).not.toMatch(
        /needs[-_ ]you|problem|failed|stuck|completed|已完成/i,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/runs') || String(input).includes('/trace'),
        ),
      ).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);

it('distinguishes loading, empty, and real network error without fabricating Work', async () => {
  const pending = deferred<Response>();
  const pendingFetch = vi.fn(async () => pending.promise);
  vi.stubGlobal('fetch', pendingFetch);

  const loadingHost = document.createElement('div');
  document.body.append(loadingHost);
  const loadingRoot = createRoot(loadingHost);
  try {
    await act(async () => {
      loadingRoot.render(<WorkListShell />);
    });
    expect(
      loadingHost.querySelector('[data-testid="work-list-loading"]'),
    ).not.toBeNull();
    expect(
      loadingHost.querySelector('[data-testid="work-list-empty"]'),
    ).toBeNull();
    expect(
      loadingHost.querySelector('[data-testid="work-list-error"]'),
    ).toBeNull();
    expect(
      loadingHost.querySelector('[data-testid="work-list"]'),
    ).toBeNull();
    expect(loadingHost.querySelector('a')).toBeNull();

    await act(async () => {
      pending.resolve(jsonResponse(emptyWorkList));
      await pending.promise;
      await Promise.resolve();
    });
    expect(
      loadingHost.querySelector('[data-testid="work-list-loading"]'),
    ).toBeNull();
    expect(
      loadingHost.querySelector('[data-testid="work-list-empty"]'),
    ).not.toBeNull();
    expect(
      loadingHost.querySelector('[data-testid="work-list-error"]'),
    ).toBeNull();
    expect(
      loadingHost.querySelector('[data-testid="work-list"]'),
    ).toBeNull();
    expect(loadingHost.querySelector('a')).toBeNull();
  } finally {
    await act(async () => loadingRoot.unmount());
    loadingHost.remove();
    vi.unstubAllGlobals();
  }

  const networkErrorFetch = vi.fn(async () => {
    throw new TypeError('network unavailable');
  });
  vi.stubGlobal('fetch', networkErrorFetch);
  const errorHost = document.createElement('div');
  document.body.append(errorHost);
  const errorRoot = createRoot(errorHost);
  try {
    await act(async () => {
      errorRoot.render(<WorkListShell />);
    });
    await settleNetworkTurn();
    expect(
      errorHost.querySelector('[data-testid="work-list-error"]'),
    ).not.toBeNull();
    expect(
      errorHost.querySelector('[data-testid="work-list-loading"]'),
    ).toBeNull();
    expect(
      errorHost.querySelector('[data-testid="work-list-empty"]'),
    ).toBeNull();
    expect(
      errorHost.querySelector('[data-testid="work-list"]'),
    ).toBeNull();
    expect(errorHost.querySelector('a')).toBeNull();
    expect(networkErrorFetch).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => errorRoot.unmount());
    errorHost.remove();
    vi.unstubAllGlobals();
  }
});
