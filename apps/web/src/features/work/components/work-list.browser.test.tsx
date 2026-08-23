import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import type {
  WorkListItem,
  WorkListResponse,
} from '@atomlink-ye/agent-server/product-contract';
import { WorkListPage } from '@/features/work/pages/WorkListPage';
import parallelRecording from '@/lib/__fixtures__/product-recordings/parallel-success.json';
import { projectWorkList } from '@/lib/product-recording-projections';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseWork = projectWorkList(parallelRecording).works[0]!;
const stateCases = [
  ['running', 'Running'],
  ['needs_you', 'Needs You'],
  ['complete', 'Complete'],
  ['problem', 'Problem'],
  ['not_captured', 'State unavailable'],
] as const;

const populatedWorkList: WorkListResponse = {
  works: stateCases.map(([productState], index): WorkListItem => ({
    ...baseWork,
    id: uuid(index + 1),
    title: `Work ${index + 1}`,
    product_state: productState,
    latest_run_summary: {
      id: uuid(index + 101),
      updated_at: `2026-08-16T10:0${index}:00.000Z`,
      result_summary: `Latest recorded result ${index + 1}`,
      result_capture_status: 'present',
    },
  })),
  next_cursor: null,
};

const emptyWorkList: WorkListResponse = {
  works: [],
  next_cursor: null,
};

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

async function settleNetworkTurn() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it('renders Product Work state and latest Run summary with one list read', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    expect(input).toBe('/api/works');
    return jsonResponse(populatedWorkList);
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<WorkListPage />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain('Does this need me?');
    const cards = [...host.querySelectorAll<HTMLLIElement>('.work-list-card')];
    expect(cards).toHaveLength(stateCases.length);
    for (const [index, [, stateLabel]] of stateCases.entries()) {
      const card = cards[index]!;
      expect(card.textContent).toContain(stateLabel);
      expect(card.textContent).toContain(`Latest recorded result ${index + 1}`);
      expect(
        card
          .querySelector('[data-product-state]')
          ?.getAttribute('data-product-state'),
      ).toBe(stateCases[index]![0]);
      expect(card.querySelector('a')?.getAttribute('href')).toBe(
        `/works/${populatedWorkList.works[index]!.id}`,
      );
    }

    expect(host.textContent).not.toContain('TeamRun');
    expect(host.textContent).not.toContain('RuntimeSession');
    expect(host.textContent).not.toContain('participating Agents');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('distinguishes loading, empty, and real network error without fabricating Work', async () => {
  let resolvePending!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolvePending = resolve;
  });
  const pendingFetch = vi.fn(async () => pending);
  vi.stubGlobal('fetch', pendingFetch);

  const loadingHost = document.createElement('div');
  document.body.append(loadingHost);
  const loadingRoot = createRoot(loadingHost);
  try {
    await act(async () => {
      loadingRoot.render(<WorkListPage />);
    });
    expect(
      loadingHost.querySelector('[data-testid="work-list-loading"]'),
    ).not.toBeNull();
    expect(loadingHost.querySelector('[data-testid="work-list"]')).toBeNull();

    await act(async () => {
      resolvePending(jsonResponse(emptyWorkList));
      await pending;
      await Promise.resolve();
    });
    expect(
      loadingHost.querySelector('[data-testid="work-list-empty"]'),
    ).not.toBeNull();
    expect(loadingHost.querySelector('a[href^="/works/"]')).toBeNull();
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
      errorRoot.render(<WorkListPage />);
    });
    await settleNetworkTurn();
    expect(
      errorHost.querySelector('[data-testid="work-list-error"]'),
    ).not.toBeNull();
    expect(errorHost.textContent).toContain('This is a connection problem');
    expect(errorHost.querySelector('[data-testid="work-list"]')).toBeNull();
  } finally {
    await act(async () => errorRoot.unmount());
    errorHost.remove();
    vi.unstubAllGlobals();
  }
});
