import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as streamReducer from './stream-reducer';

const fixturePath = new URL(
  './__fixtures__/s1-product-session-run-events.jsonl',
  import.meta.url,
);
const metadataPath = new URL(
  './__fixtures__/s1-product-session-run-events.meta.json',
  import.meta.url,
);
const fixtureRunId = 'run-s5-product-session-cumulative';
const canonicalPrompt =
  'Use the shell tool exactly once to run printf TOOL_OK. Then write twelve numbered plain-text sentences about deterministic event streams. Each sentence must contain at least twelve words. Do not use another tool.';
const userMessageId = 'message-fixture-user-1';
const assistantMessageId = 'message-fixture-assistant-1';

type FixtureMetadata = {
  readonly schema: string;
  readonly base_commit: string;
  readonly captured_at: string;
  readonly fixture_run_id: string;
  readonly event_count: number;
  readonly last_sequence: number;
  readonly terminal: string;
  readonly types: Record<string, number>;
  readonly kinds: Record<string, number>;
  readonly assistant_text: {
    readonly classification: string;
    readonly observed_classification: string;
    readonly frame_count: number;
    readonly sequences: readonly number[];
    readonly lengths: readonly number[];
    readonly strict_monotonic_prefix: boolean;
    readonly thinking_between_snapshots: boolean;
    readonly sequence_26_is_prefix_of_29: boolean;
    readonly canonical_saved_present: boolean;
    readonly canonical_saved_length: number;
    readonly canonical_equals_last_snapshot: boolean;
    readonly canonical_saved_sha256: string;
    readonly last_snapshot_sha256: string;
  };
};

type PlannedTimelineApi = {
  readonly initialTimelineState?: unknown;
  readonly applyTimelineEnvelope?: (
    state: unknown,
    envelope: unknown,
  ) => unknown;
  readonly applyTimelineEnvelopes?: (
    state: unknown,
    envelopes: readonly unknown[],
  ) => unknown;
};

function fixtureLines(): readonly string[] {
  return readFileSync(fixturePath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
}

function fixtureEvents() {
  return fixtureLines().map((line) => streamReducer.parseRunStreamEvent(line));
}

function payloadOf(
  event: ReturnType<typeof streamReducer.parseRunStreamEvent>,
) {
  if (!event || !event.payload || typeof event.payload !== 'object')
    return null;
  return event.payload as Record<string, unknown>;
}

function entriesForRun(state: unknown, runId: string): readonly unknown[] {
  const runs = (
    state as { runs?: Record<string, { entries?: readonly unknown[] }> }
  ).runs;
  return runs?.[runId]?.entries ?? [];
}

describe('S5 ProductSession cumulative replay fixture', () => {
  it('preserves the captured JSONL contract and observed classification', () => {
    const metadata = JSON.parse(
      readFileSync(metadataPath, 'utf8'),
    ) as FixtureMetadata;
    const events = fixtureEvents();

    expect(metadata.schema).toBe('s5-task1-run-events-fixture-v1');
    expect(metadata.base_commit).toBe(
      'ef7c57247f21acf071c19cc5216e1ffd33eeb997',
    );
    expect(metadata.captured_at).toBe('2026-08-08');
    expect(metadata.fixture_run_id).toBe(fixtureRunId);
    expect(events).toHaveLength(metadata.event_count);
    expect(events.every((event) => event !== null)).toBe(true);
    const parsed = events.filter(
      (event): event is NonNullable<typeof event> => event !== null,
    );
    expect(parsed.map((event) => event.sequence)).toEqual(
      Array.from({ length: metadata.event_count }, (_, index) => index + 1),
    );
    expect(parsed.at(-1)?.sequence).toBe(metadata.last_sequence);
    expect(parsed.at(-1)).toMatchObject({
      sequence: metadata.last_sequence,
      type: metadata.terminal,
    });
    expect(parsed.map((event) => event.type)).toEqual([
      'started',
      ...Array.from({ length: 30 }, () => 'output'),
      metadata.terminal,
    ]);
    expect(
      parsed.reduce(
        (counts, event) => {
          counts[event.type] = (counts[event.type] ?? 0) + 1;
          return counts;
        },
        {} as Record<string, number>,
      ),
    ).toEqual(metadata.types);

    const kinds = parsed
      .map(payloadOf)
      .filter((payload): payload is Record<string, unknown> => payload !== null)
      .reduce(
        (counts, payload) => {
          if (typeof payload.kind === 'string') {
            const count = counts[payload.kind];
            counts[payload.kind] = typeof count === 'number' ? count + 1 : 1;
          }
          return counts;
        },
        {} as Record<string, number>,
      );
    expect(kinds).toEqual(metadata.kinds);

    const assistantFrames = parsed
      .map((event) => ({ event, payload: payloadOf(event) }))
      .filter(
        (
          item,
        ): item is {
          event: NonNullable<(typeof events)[number]>;
          payload: Record<string, unknown>;
        } => item.payload?.kind === 'assistant_text',
      )
      .map(({ event, payload }) => ({
        sequence: event.sequence,
        text: typeof payload.text === 'string' ? payload.text : '',
      }));
    expect(assistantFrames.map((frame) => frame.sequence)).toEqual(
      metadata.assistant_text.sequences,
    );
    expect(assistantFrames.map((frame) => frame.text.length)).toEqual(
      metadata.assistant_text.lengths,
    );
    expect(
      assistantFrames.slice(1).every((frame, index) => {
        const previous = assistantFrames[index]?.text ?? '';
        return (
          frame.text.length > previous.length && frame.text.startsWith(previous)
        );
      }),
    ).toBe(metadata.assistant_text.strict_monotonic_prefix);
    expect(
      parsed.some(
        (event) =>
          event.sequence > 26 &&
          event.sequence < 29 &&
          payloadOf(event)?.kind === 'reasoning_progress',
      ),
    ).toBe(metadata.assistant_text.thinking_between_snapshots);
    const frame26 = assistantFrames.find((frame) => frame.sequence === 26);
    const frame29 = assistantFrames.find((frame) => frame.sequence === 29);
    expect(frame29?.text.startsWith(frame26?.text ?? '')).toBe(
      metadata.assistant_text.sequence_26_is_prefix_of_29,
    );
    expect(metadata.assistant_text.observed_classification).toBe(
      'cumulative only',
    );
    expect(metadata.assistant_text.classification).toBe('cumulative');
    expect(metadata.assistant_text.frame_count).toBe(23);
    expect(metadata.assistant_text.canonical_saved_present).toBe(true);
    expect(metadata.assistant_text.canonical_saved_length).toBe(1823);
    expect(metadata.assistant_text.canonical_equals_last_snapshot).toBe(true);
    const lastSnapshot = assistantFrames.at(-1)?.text ?? '';
    const lastSnapshotSha256 = createHash('sha256')
      .update(lastSnapshot)
      .digest('hex');
    expect(lastSnapshotSha256).toBe(
      metadata.assistant_text.last_snapshot_sha256,
    );
    expect(metadata.assistant_text.canonical_saved_sha256).toBe(
      lastSnapshotSha256,
    );
  });

  it('locks the future ordered entry snapshot (red on the legacy map-and-bucket reducer)', () => {
    const events = fixtureEvents();
    const parsed = events.filter(
      (event): event is NonNullable<typeof event> => event !== null,
    );
    const api = streamReducer as unknown as PlannedTimelineApi;
    expect(api.initialTimelineState).toBeDefined();
    expect(typeof api.applyTimelineEnvelope).toBe('function');
    expect(typeof api.applyTimelineEnvelopes).toBe('function');
    if (
      api.initialTimelineState === undefined ||
      typeof api.applyTimelineEnvelope !== 'function' ||
      typeof api.applyTimelineEnvelopes !== 'function'
    )
      return;
    const initialSnapshot = structuredClone(api.initialTimelineState);
    const freshInitialState = () => structuredClone(initialSnapshot);
    const reasoningAt = (sequence: number) => {
      const event = parsed.find((candidate) => candidate.sequence === sequence);
      const payload = payloadOf(event ?? null);
      return typeof payload?.text === 'string' ? payload.text : undefined;
    };
    const tool = payloadOf(
      parsed.find((event) => event.sequence === 4) ?? null,
    );
    // Classification evidence proves canonical saved text equals the final snapshot;
    // apply it as a separate canonical envelope rather than inventing a run event.
    const finalAssistantText =
      payloadOf(parsed.find((event) => event.sequence === 29) ?? null)?.text ??
      '';
    const usagePayload = payloadOf(
      parsed.find((event) => event.sequence === 30) ?? null,
    );
    const runtimeEnvelopes = parsed.map((event) => ({
      runId: fixtureRunId,
      update: { kind: 'runEvent', event },
    }));
    const envelopes = [
      {
        runId: fixtureRunId,
        update: {
          kind: 'prompt',
          text: canonicalPrompt,
          messageId: userMessageId,
        },
      },
      ...runtimeEnvelopes,
      {
        runId: fixtureRunId,
        update: {
          kind: 'canonicalAgentText',
          text: finalAssistantText,
          messageId: assistantMessageId,
        },
      },
    ];
    const replayState = api.applyTimelineEnvelopes(
      freshInitialState(),
      envelopes,
    );
    const liveState = envelopes.reduce<unknown>(
      (state, envelope) => api.applyTimelineEnvelope!(state, envelope),
      freshInitialState(),
    );
    expect(liveState).toEqual(replayState);
    const prefixState = envelopes
      .slice(0, Math.ceil(envelopes.length / 2))
      .reduce<unknown>(
        (state, envelope) => api.applyTimelineEnvelope!(state, envelope),
        freshInitialState(),
      );
    const catchUpState = api.applyTimelineEnvelopes(prefixState, envelopes);
    expect(catchUpState).toEqual(replayState);
    const secondRunId = `${fixtureRunId}-second`;
    const secondRunEnvelopes = envelopes.map((envelope) => ({
      ...envelope,
      runId: secondRunId,
    }));
    const dualRunState = api.applyTimelineEnvelopes(freshInitialState(), [
      ...envelopes,
      ...secondRunEnvelopes,
    ]);
    const dualRuns = (dualRunState as { runs: Record<string, unknown> }).runs;
    expect(Object.keys(dualRuns).sort()).toEqual(
      [fixtureRunId, secondRunId].sort(),
    );
    for (const runId of [fixtureRunId, secondRunId]) {
      expect(entriesForRun(dualRunState, runId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activityId: { scope: 'wire', value: 'activity-1' },
          }),
        ]),
      );
    }
    const expectedEntries = [
      {
        kind: 'prompt',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: `prompt:${userMessageId}` },
        firstSequence: null,
        lastSequence: null,
        text: canonicalPrompt,
        messageId: userMessageId,
      },
      {
        kind: 'lifecycle',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'lifecycle:1' },
        firstSequence: 1,
        lastSequence: 1,
        status: 'started',
      },
      {
        kind: 'thinking',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'thinking:2' },
        firstSequence: 2,
        lastSequence: 2,
        origin: 'reasoning_progress',
        status: 'completed',
        text: reasoningAt(2),
      },
      {
        kind: 'tool',
        runId: fixtureRunId,
        activityId: { scope: 'wire', value: 'activity-1' },
        firstSequence: 3,
        lastSequence: 4,
        origin: 'tool_status',
        category: 'shell',
        sourceActivityId: 'activity-1',
        status: 'completed',
        label: tool?.label,
        summary: tool?.summary,
        detailKind: 'shell',
        detailText: 'TOOL_OK',
      },
      {
        kind: 'agentText',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'agent-text:5' },
        firstSequence: 5,
        lastSequence: 29,
        origin: 'assistant_text',
        text: finalAssistantText,
        status: 'saved',
        messageId: assistantMessageId,
      },
      {
        kind: 'thinking',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'thinking:27' },
        firstSequence: 27,
        lastSequence: 28,
        origin: 'reasoning_progress',
        status: 'completed',
        text: reasoningAt(28),
      },
      {
        kind: 'usage',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'usage' },
        firstSequence: 30,
        lastSequence: 30,
        usage: {
          inputTokens: usagePayload?.input_tokens,
          cachedInputTokens: usagePayload?.cached_input_tokens,
          outputTokens: usagePayload?.output_tokens,
          contextWindowMaxTokens: usagePayload?.context_window_max_tokens,
          contextWindowUsedTokens: usagePayload?.context_window_used_tokens,
        },
      },
      {
        kind: 'lifecycle',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'lifecycle:32' },
        firstSequence: 32,
        lastSequence: 32,
        status: 'succeeded',
      },
    ];
    expect(entriesForRun(replayState, fixtureRunId)).toEqual(expectedEntries);
    expect(entriesForRun(dualRunState, fixtureRunId)).toEqual(expectedEntries);
    expect(entriesForRun(dualRunState, fixtureRunId)).not.toBe(
      entriesForRun(dualRunState, secondRunId),
    );
    expect(entriesForRun(dualRunState, secondRunId)).toEqual(
      expectedEntries.map((entry) => ({ ...entry, runId: secondRunId })),
    );
    expect(api.initialTimelineState).toEqual(initialSnapshot);
  });
});
