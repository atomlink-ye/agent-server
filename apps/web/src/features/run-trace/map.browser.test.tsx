import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import parallelRecording from '@/lib/__fixtures__/product-recordings/parallel-success.json';
import reworkRecording from '@/lib/__fixtures__/product-recordings/rework-once.json';
import { RunTrace } from './run-trace-view';
import { attemptsFrom } from './selectors';
import { parseRecordedTrace } from './recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('renders Attempt nodes in Map and keeps selection synchronized with Timeline and Inspector', async () => {
  const trace = parseRecordedTrace(reworkRecording);
  const attempts = attemptsFrom(trace);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    await act(async () => {
      root.render(<RunTrace trace={trace} />);
    });

    const mapTab = [
      ...host.querySelectorAll<HTMLButtonElement>('.run-trace__tab'),
    ].find((button) => button.textContent?.trim() === 'Map');
    expect(mapTab).toBeDefined();
    if (!mapTab) return;
    await act(async () => mapTab.click());

    const nodes = [
      ...host.querySelectorAll<HTMLButtonElement>('.run-trace__map-node'),
    ];
    expect(nodes).toHaveLength(attempts.length);
    expect(host.querySelector('[data-testid="trace-map"]')).not.toBeNull();
    expect(host.textContent).toContain('Captured relations');

    const target = attempts.at(-1)!;
    const targetNode = nodes.find(
      (node) =>
        node.textContent?.includes(target.workItem.subject) &&
        node.textContent?.includes(`Attempt ${target.attempt.attemptNo}`),
    );
    expect(targetNode).toBeDefined();
    if (!targetNode) return;
    await act(async () => targetNode.click());
    expect(targetNode.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.run-trace__inspector')?.textContent).toContain(
      target.workItem.subject,
    );

    const timelineTab = [
      ...host.querySelectorAll<HTMLButtonElement>('.run-trace__tab'),
    ].find((button) => button.textContent?.trim() === 'Timeline');
    expect(timelineTab).toBeDefined();
    if (!timelineTab) return;
    await act(async () => timelineTab.click());

    const selectedSpan = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[data-testid="trace-attempt"]',
      ),
    ].find(
      (button) =>
        button.getAttribute('aria-pressed') === 'true' &&
        button.title === target.workItem.subject &&
        button
          .getAttribute('aria-label')
          ?.includes(`Attempt ${target.attempt.attemptNo}`),
    );
    expect(selectedSpan).toBeDefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('exposes Agent message summaries and MCP activity through Inspector detail lenses without inventing provider text', async () => {
  const trace = parseRecordedTrace(reworkRecording);
  const target = attemptsFrom(trace).find(({ workItem }) =>
    trace.edges.some(
      (edge) =>
        edge.kind === 'observed_message' && edge.workItemId === workItem.id,
    ),
  );
  expect(target).toBeDefined();
  if (!target) return;

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<RunTrace trace={trace} />));
    const targetSpan = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[data-testid="trace-attempt"]',
      ),
    ].find((button) => button.title === target.workItem.subject);
    expect(targetSpan).toBeDefined();
    if (!targetSpan) return;
    await act(async () => targetSpan.click());

    const conversationTab = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.run-trace__inspector-tabs button',
      ),
    ].find((button) => button.textContent?.trim() === 'Conversation');
    expect(conversationTab).toBeDefined();
    if (!conversationTab) return;
    await act(async () => conversationTab.click());
    expect(
      host.querySelector('[data-testid="attempt-conversation"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('full provider transcript');

    const activityTab = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.run-trace__inspector-tabs button',
      ),
    ].find((button) => button.textContent?.trim() === 'Activity');
    expect(activityTab).toBeDefined();
    if (!activityTab) return;
    await act(async () => activityTab.click());
    expect(
      host.querySelector('[data-testid="attempt-activity"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('Direct shell');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('clicking a timeline message marker locates and highlights the message in ConversationDetail', async () => {
  const trace = parseRecordedTrace(parallelRecording);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<RunTrace trace={trace} />);
    });

    // Switch to Timeline view (default, but be explicit)
    const timelineTab = [
      ...host.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
    ].find((button) => button.textContent?.trim() === 'Timeline');
    if (timelineTab) await act(async () => timelineTab.click());

    // Find a message marker
    const marker = host.querySelector<HTMLButtonElement>(
      '[data-testid="timeline-message-marker"]',
    );
    expect(marker).not.toBeNull();
    if (!marker) return;

    // Click the marker
    await act(async () => marker.click());

    // Inspector should now be in conversation mode with a targeted message
    const conversation = host.querySelector(
      '[data-testid="attempt-conversation"]',
    );
    expect(conversation).not.toBeNull();

    // The targeted message should have the highlight class
    const targeted = host.querySelector('.run-trace__message--targeted');
    expect(targeted).not.toBeNull();
    expect(targeted?.getAttribute('data-message-id')).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
