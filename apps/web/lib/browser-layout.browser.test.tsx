import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { commands } from 'vitest/browser';

import '@/app/cloudflare-os-tokens.css';
import '@/app/globals.css';
import { AssistantMarkdown } from '@/components/chat/assistant-markdown';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const shortFixture = 'A short assistant response.';

const longFixture = `First paragraph with enough content to occupy several lines in the assistant response.

Second paragraph adds more rendered content so the measured layout must grow after rerendering.

Third paragraph keeps the fixture as a multi-paragraph markdown response.`;

function nextTwoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

it('S6 Step0 measures real AssistantMarkdown layout growth', async () => {
  const hasDom = typeof document === 'object';
  expect(hasDom).toBe(true);
  if (!hasDom) return;

  const host = document.createElement('div');
  host.style.width = '320px';
  document.body.append(host);
  const root = createRoot(host);
  let resizeObserver: ResizeObserver | undefined;

  try {
    await act(async () => {
      root.render(<AssistantMarkdown text={shortFixture} />);
    });

    const markdown = host.querySelector<HTMLElement>('.assistant-markdown');
    expect(markdown).not.toBeNull();
    if (!markdown) return;

    const before = markdown.getBoundingClientRect().height;
    expect(before).toBeGreaterThan(0);

    const observedHeights: number[] = [];
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries)
        observedHeights.push(entry.contentRect.height);
    });
    resizeObserver.observe(markdown);

    await act(async () => {
      root.render(<AssistantMarkdown text={longFixture} />);
    });
    await nextTwoFrames();

    const after = markdown.getBoundingClientRect().height;
    expect(after).toBeGreaterThan(before);
    expect(observedHeights.some((height) => height >= after)).toBe(true);

    const computed = getComputedStyle(markdown);
    const inventoryResult = await commands.writeInventory(
      JSON.stringify({
        selector: '.assistant-markdown',
        before,
        after,
        observedHeights,
        display: computed.display,
        lineHeight: computed.lineHeight,
      }),
      'canary',
    );
    expect(inventoryResult.path).toMatch(
      /vitest-browser-canary-inventory\.json$/u,
    );
    expect(inventoryResult.bytes).toBeGreaterThan(0);
  } finally {
    resizeObserver?.disconnect();
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});
