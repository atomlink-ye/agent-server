import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import parallelRecording from '@/test-support/fixtures/product-recordings/parallel-success.json';
import reworkRecording from '@/test-support/fixtures/product-recordings/rework-once.json';
import { RunTrace } from './run-trace-view';
import { attemptsFrom } from './selectors';
import { parseRecordedTrace } from '@/test-support/run-trace-recording-test-helpers';
import type { NormalizedTrace } from './normalized';

/** A single-agent Work: no Team, so no actors, Work Items, or Attempts. */
function singleAgentTrace(): NormalizedTrace {
  return {
    runId: 'work-run-1',
    work: { id: 'work-1', title: 'Single-agent Work' },
    workRun: { id: 'work-run-1', productState: 'succeeded' },
    actors: new Map(),
    workItems: new Map(),
    attempts: new Map(),
    messages: new Map(),
    activities: [],
    edges: [],
    runs: [
      {
        id: 'run-a',
        status: 'succeeded',
        actorId: null,
        workItemId: null,
        taskId: 'task-a',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:05:00.000Z',
      },
    ],
    events: [],
    timeline: {
      startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
      endedAt: Date.parse('2026-01-01T00:05:00.000Z'),
    },
    coverage: {
      scope: 'mcp_dispatch_and_confirmation',
      completeness: 'mcp_only',
      excludedExecution: [],
    },
  };
}

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

it('a Team message marker selects the Run span joined to it via the run-attempt taskId join', async () => {
  const trace = parseRecordedTrace(parallelRecording);
  // The first recorded message (source_created_at earliest) carries
  // attempt_id 79dd406d..., which belongs to this Work Item's first (and
  // only) Attempt. Spans are Run-shaped now (this change's whole point),
  // so the marker click can only land on the right Timeline span if
  // selectTimelineSpans's run->attempt taskId join actually resolved it.
  const targetAttemptId = '79dd406d-57ec-4de8-b974-f1bf965dd61f';
  const targetWorkItem = [...trace.workItems.values()].find((item) =>
    item.attempts.some((attempt) => attempt.id === targetAttemptId),
  );
  expect(targetWorkItem).toBeDefined();
  const targetAttempt = targetWorkItem?.attempts.find(
    (attempt) => attempt.id === targetAttemptId,
  );
  expect(targetAttempt).toBeDefined();
  if (!targetWorkItem || !targetAttempt) return;

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<RunTrace trace={trace} />);
    });

    const marker = host.querySelector<HTMLButtonElement>(
      '[data-testid="timeline-message-marker"]',
    );
    expect(marker).not.toBeNull();
    if (!marker) return;
    await act(async () => marker.click());

    const selectedSpan = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[data-testid="trace-attempt"]',
      ),
    ].find((button) => button.getAttribute('aria-pressed') === 'true');
    expect(selectedSpan).toBeDefined();
    if (!selectedSpan) return;
    expect(selectedSpan.title).toBe(targetWorkItem.subject);
    expect(selectedSpan.getAttribute('aria-label')).toContain(
      `Attempt ${targetAttempt.attemptNo}`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('renders an explicit empty state for a single-agent Work with no collaboration graph', async () => {
  const trace = singleAgentTrace();
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

    // No fabricated dependency graph, and no "0 Attempt node(s)" counter
    // that would look like a capture failure rather than a Team concept
    // that does not apply to this Work.
    expect(host.querySelector('.run-trace__map-node')).toBeNull();
    expect(host.textContent).not.toContain('Attempt node(s)');
    expect(host.textContent).toContain(
      'No collaboration graph was recorded for this Work.',
    );
    expect(host.textContent).toContain('ran as a single Agent');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
