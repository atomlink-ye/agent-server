import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as streamReducer from './stream-reducer';
import type {
  AgentTextEntry,
  TimelineEntry,
  TimelineEnvelope,
  TimelineState,
} from './stream-reducer';

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
  readonly runtime: {
    readonly provider: string;
    readonly model: string;
    readonly recording: string;
  };
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

function stringField(
  payload: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' ? value : undefined;
}

function requiredStringField(
  payload: Record<string, unknown> | null,
  key: string,
): string {
  const value = stringField(payload, key);
  if (value === undefined) throw new Error(`expected string field: ${key}`);
  return value;
}

function numberField(
  payload: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = payload?.[key];
  return typeof value === 'number' ? value : undefined;
}

function entriesForRun(
  state: TimelineState,
  runId: string,
): readonly TimelineEntry[] {
  return state.runs[runId]?.entries ?? [];
}

function assistantTextEntry(
  entry: TimelineEntry | undefined,
): Extract<AgentTextEntry, { readonly origin: 'assistant_text' }> {
  expect(entry).toBeDefined();
  if (!entry || entry.kind !== 'agentText' || entry.origin !== 'assistant_text')
    throw new Error('expected an assistant text entry');
  return entry;
}

function deterministicShuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = (index * 7 + 3) % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }
  return shuffled;
}

function runtimeSequence(envelope: TimelineEnvelope): number {
  if (envelope.update.kind !== 'runEvent')
    throw new Error('expected a runtime envelope');
  return envelope.update.event.sequence;
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
    expect(metadata.runtime).toEqual({
      provider: 'unknown',
      model: 'unknown',
      recording:
        'Provider and model were not recorded during the original capture; values are intentionally not inferred after the fact.',
    });
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

  it('locks the ordered entry snapshot across deterministic runtime reordering', () => {
    const events = fixtureEvents();
    const parsed = events.filter(
      (event): event is NonNullable<typeof event> => event !== null,
    );
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
    const finalAssistantTextValue = payloadOf(
      parsed.find((event) => event.sequence === 29) ?? null,
    )?.text;
    const finalAssistantText =
      typeof finalAssistantTextValue === 'string'
        ? finalAssistantTextValue
        : '';
    const usagePayload = payloadOf(
      parsed.find((event) => event.sequence === 30) ?? null,
    );
    const runtimeEnvelopes: TimelineEnvelope[] = parsed.map((event) => ({
      runId: fixtureRunId,
      update: { kind: 'runEvent', event },
    }));
    const promptEnvelope: TimelineEnvelope = {
      runId: fixtureRunId,
      update: {
        kind: 'prompt',
        text: canonicalPrompt,
        messageId: userMessageId,
      },
    };
    const canonicalEnvelope: TimelineEnvelope = {
      runId: fixtureRunId,
      update: {
        kind: 'canonicalAgentText',
        text: finalAssistantText,
        messageId: assistantMessageId,
      },
    };
    const orderedEnvelopes: TimelineEnvelope[] = [
      promptEnvelope,
      ...runtimeEnvelopes,
      canonicalEnvelope,
    ];
    const shuffledRuntimeEnvelopes = deterministicShuffle(runtimeEnvelopes);
    expect(shuffledRuntimeEnvelopes.map(runtimeSequence)).not.toEqual(
      runtimeEnvelopes.map(runtimeSequence),
    );
    expect(shuffledRuntimeEnvelopes.map(runtimeSequence)).toEqual(
      expect.arrayContaining(runtimeEnvelopes.map(runtimeSequence)),
    );
    const shuffledEnvelopes: TimelineEnvelope[] = [
      promptEnvelope,
      ...shuffledRuntimeEnvelopes,
      canonicalEnvelope,
    ];
    const goldenState = streamReducer.applyTimelineEnvelopes(
      streamReducer.initialTimelineState,
      orderedEnvelopes,
    );
    const replayState = streamReducer.applyTimelineEnvelopes(
      streamReducer.initialTimelineState,
      shuffledEnvelopes,
    );
    expect(replayState).toEqual(goldenState);
    const prefixState = streamReducer.applyTimelineEnvelopes(
      streamReducer.initialTimelineState,
      orderedEnvelopes.slice(0, Math.ceil(orderedEnvelopes.length / 2)),
    );
    const catchUpState = streamReducer.applyTimelineEnvelopes(
      prefixState,
      orderedEnvelopes,
    );
    expect(catchUpState).toEqual(goldenState);
    const secondRunId = `${fixtureRunId}-second`;
    const secondRunEnvelopes = orderedEnvelopes.map((envelope) => ({
      ...envelope,
      runId: secondRunId,
    }));
    const dualRunState = streamReducer.applyTimelineEnvelopes(
      streamReducer.initialTimelineState,
      [...orderedEnvelopes, ...secondRunEnvelopes],
    );
    const dualRuns = dualRunState.runs;
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
        firstCreatedAt: null,
        lastCreatedAt: null,
        text: canonicalPrompt,
        messageId: userMessageId,
      },
      {
        kind: 'lifecycle',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'lifecycle:1' },
        firstSequence: 1,
        lastSequence: 1,
        firstCreatedAt: null,
        lastCreatedAt: null,
        status: 'started',
      },
      {
        kind: 'thinking',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'thinking:2' },
        firstSequence: 2,
        lastSequence: 2,
        firstCreatedAt: null,
        lastCreatedAt: null,
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
        firstCreatedAt: null,
        lastCreatedAt: null,
        label: requiredStringField(tool, 'label'),
        summary: requiredStringField(tool, 'summary'),
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
        firstCreatedAt: null,
        lastCreatedAt: null,
        messageId: assistantMessageId,
      },
      {
        kind: 'thinking',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'thinking:27' },
        firstSequence: 27,
        lastSequence: 28,
        firstCreatedAt: null,
        lastCreatedAt: null,
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
        firstCreatedAt: null,
        lastCreatedAt: null,
        usage: {
          inputTokens: numberField(usagePayload, 'input_tokens'),
          cachedInputTokens: numberField(usagePayload, 'cached_input_tokens'),
          outputTokens: numberField(usagePayload, 'output_tokens'),
          contextWindowMaxTokens: numberField(
            usagePayload,
            'context_window_max_tokens',
          ),
          contextWindowUsedTokens: numberField(
            usagePayload,
            'context_window_used_tokens',
          ),
        },
      },
      {
        kind: 'lifecycle',
        runId: fixtureRunId,
        activityId: { scope: 'local', value: 'lifecycle:32' },
        firstSequence: 32,
        lastSequence: 32,
        firstCreatedAt: null,
        lastCreatedAt: null,
        status: 'succeeded',
      },
    ] satisfies readonly TimelineEntry[];
    expect(entriesForRun(goldenState, fixtureRunId)).toEqual(expectedEntries);
    expect(entriesForRun(replayState, fixtureRunId)).toEqual(expectedEntries);
    expect(entriesForRun(dualRunState, fixtureRunId)).toEqual(expectedEntries);
    expect(entriesForRun(dualRunState, fixtureRunId)).not.toBe(
      entriesForRun(dualRunState, secondRunId),
    );
    expect(entriesForRun(dualRunState, secondRunId)).toEqual(
      expectedEntries.map((entry) => ({ ...entry, runId: secondRunId })),
    );
    expect(streamReducer.initialTimelineState).toEqual({
      runs: {},
      diagnostics: [],
    });
  });

  it('does not reorder run events across a canonical envelope barrier', () => {
    const runId = 'barrier-run';
    const envelopes: readonly TimelineEnvelope[] = [
      {
        runId,
        update: {
          kind: 'runEvent',
          event: {
            sequence: 2,
            type: 'output',
            payload: { kind: 'assistant_text', text: 'AB' },
          },
        },
      },
      {
        runId,
        update: {
          kind: 'canonicalAgentText',
          text: 'canonical',
          messageId: 'barrier-assistant',
        },
      },
      {
        runId,
        update: {
          kind: 'runEvent',
          event: {
            sequence: 1,
            type: 'output',
            payload: { kind: 'assistant_text', text: 'A' },
          },
        },
      },
    ];
    const state = streamReducer.applyTimelineEnvelopes(
      streamReducer.initialTimelineState,
      envelopes,
    );
    const text = assistantTextEntry(entriesForRun(state, runId)[0]);
    expect(text).toMatchObject({
      activityId: { scope: 'local', value: 'agent-text:2' },
      firstSequence: 2,
      lastSequence: 2,
      text: 'canonical',
      status: 'saved',
      messageId: 'barrier-assistant',
    });
    expect(state.runs[runId]?.lastSequence).toBe(2);
  });
});
