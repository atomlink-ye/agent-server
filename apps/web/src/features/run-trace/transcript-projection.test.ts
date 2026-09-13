import { expect, it } from 'vitest';
import type { ProductExecutionDetailEvent } from '@atomlink-ye/agent-server/product-contract';

import {
  projectTranscript,
  type TranscriptEntry,
} from './transcript-projection';

const at = (
  ordinal: number,
  event: ProductExecutionDetailEvent,
): TranscriptEntry => ({ ...event, ordinal });
const timestamp = '2026-08-18T04:00:00.000Z';

it('preserves every source ordinal while compacting a transcript', () => {
  const input = [
    at(1, {
      kind: 'reasoning_progress',
      status: 'started',
      text: null,
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'reasoning_progress',
      status: 'completed',
      text: 'thought',
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'tool_status',
      activity_id: 'read-1',
      category: 'read',
      status: 'running',
      label: 'Read',
      summary: null,
      provider: null,
      tool_name: null,
      detail_kind: null,
      detail_text: null,
      exit_code: null,
      parent_activity_id: null,
      sequence: 3,
      created_at: timestamp,
    }),
    at(4, {
      kind: 'tool_status',
      activity_id: 'read-1',
      category: 'read',
      status: 'completed',
      label: 'Read',
      summary: 'config.ts',
      provider: null,
      tool_name: null,
      detail_kind: 'read',
      detail_text: 'detail',
      exit_code: 0,
      parent_activity_id: null,
      sequence: 4,
      created_at: timestamp,
    }),
    at(5, {
      kind: 'assistant_text',
      text: 'A',
      sequence: 5,
      created_at: timestamp,
    }),
    at(6, {
      kind: 'assistant_text',
      text: 'AB',
      sequence: 6,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  expect(
    output.flatMap((entry) => entry.sourceOrdinals).sort((a, b) => a - b),
  ).toEqual(input.map((entry) => entry.ordinal).sort((a, b) => a - b));
});

it('does not swallow a later run after a lifecycle terminal event', () => {
  const input = [
    at(1, {
      kind: 'lifecycle',
      status: 'started',
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'assistant_text',
      text: 'first',
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'lifecycle',
      status: 'succeeded',
      sequence: 3,
      created_at: timestamp,
    }),
    at(4, {
      kind: 'assistant_text',
      text: 'second',
      sequence: 1,
      created_at: timestamp,
    }),
    at(5, {
      kind: 'lifecycle',
      status: 'started',
      sequence: 2,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  expect(output.flatMap((entry) => entry.sourceOrdinals)).toEqual(
    expect.arrayContaining([4, 5]),
  );
});

it('does not merge the same provider activity id across sequence-reset runs', () => {
  const input = [
    at(1, {
      kind: 'lifecycle',
      status: 'started',
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'tool_status',
      activity_id: 'activity-3',
      category: 'read',
      status: 'completed',
      label: 'Read',
      summary: 'first.ts',
      provider: null,
      tool_name: null,
      detail_kind: 'read',
      detail_text: 'first detail',
      exit_code: 0,
      parent_activity_id: null,
      sequence: 3,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'lifecycle',
      status: 'succeeded',
      sequence: 4,
      created_at: timestamp,
    }),
    at(4, {
      kind: 'lifecycle',
      status: 'started',
      sequence: 1,
      created_at: timestamp,
    }),
    at(5, {
      kind: 'tool_status',
      activity_id: 'activity-3',
      category: 'shell',
      status: 'completed',
      label: 'Shell',
      summary: 'second command',
      provider: null,
      tool_name: null,
      detail_kind: 'shell',
      detail_text: 'second detail',
      exit_code: 0,
      parent_activity_id: null,
      sequence: 3,
      created_at: timestamp,
    }),
  ];
  const tools = projectTranscript(input).filter(
    (entry) => entry.event.kind === 'tool_status',
  );
  expect(tools).toHaveLength(2);
  expect(tools.map((entry) => entry.sourceOrdinals)).toEqual([[2], [5]]);
});

it('keeps the first and final captured timestamps while merging one activity', () => {
  const output = projectTranscript([
    at(1, {
      kind: 'tool_status',
      activity_id: 'command-1',
      category: 'other',
      status: 'running',
      label: 'Other activity',
      summary: 'Other activity.',
      provider: null,
      tool_name: null,
      detail_kind: null,
      detail_text: null,
      exit_code: null,
      parent_activity_id: null,
      sequence: 1,
      created_at: '2026-08-18T04:00:00.000Z',
    }),
    at(2, {
      kind: 'tool_status',
      activity_id: 'command-1',
      category: 'other',
      status: 'completed',
      label: 'Other activity: pwd && ls -la',
      summary: 'Other activity.',
      provider: null,
      tool_name: null,
      detail_kind: null,
      detail_text: null,
      exit_code: 0,
      parent_activity_id: null,
      sequence: 2,
      created_at: '2026-08-18T04:00:01.250Z',
    }),
  ]);
  expect(output).toHaveLength(1);
  expect(output[0]).toMatchObject({
    startedAt: '2026-08-18T04:00:00.000Z',
    endedAt: '2026-08-18T04:00:01.250Z',
    sourceOrdinals: [1, 2],
  });
});

it('merges an activity only within its source Run', () => {
  const event = (
    runId: string,
    status: 'running' | 'completed',
    sequence: number,
    created_at: string,
  ): TranscriptEntry => ({
    kind: 'tool_status',
    activity_id: 'same-provider-id',
    category: 'shell',
    status,
    label: 'Other activity: pwd',
    summary: 'Other activity.',
    provider: null,
    tool_name: null,
    detail_kind: null,
    detail_text: null,
    exit_code: null,
    parent_activity_id: null,
    sequence,
    created_at,
    ordinal: sequence,
    source_refs: { run_id: runId },
  });
  const output = projectTranscript([
    event('00000000-0000-4000-8000-000000000001', 'running', 1, timestamp),
    event(
      '00000000-0000-4000-8000-000000000001',
      'completed',
      2,
      '2026-08-18T04:00:01.000Z',
    ),
    event(
      '00000000-0000-4000-8000-000000000002',
      'completed',
      1,
      '2026-08-18T04:00:02.000Z',
    ),
  ]);
  expect(output).toHaveLength(2);
  expect(output[0]?.sourceOrdinals).toEqual([1, 2]);
  expect(output[1]?.sourceOrdinals).toEqual([1]);
});

it('keeps interleaved assistant and reasoning entries isolated by source Run', () => {
  const runEntry = (
    ordinal: number,
    runId: string,
    event: ProductExecutionDetailEvent,
  ): TranscriptEntry => ({
    ...event,
    ordinal,
    source_refs: { run_id: runId },
  });
  const runA = '00000000-0000-4000-8000-000000000011';
  const runB = '00000000-0000-4000-8000-000000000012';
  const output = projectTranscript([
    runEntry(1, runA, {
      kind: 'reasoning_progress',
      status: 'started',
      text: null,
      sequence: 1,
      created_at: timestamp,
    }),
    runEntry(2, runB, {
      kind: 'reasoning_progress',
      status: 'started',
      text: null,
      sequence: 1,
      created_at: timestamp,
    }),
    runEntry(3, runA, {
      kind: 'reasoning_progress',
      status: 'completed',
      text: 'Reasoning A',
      sequence: 2,
      created_at: '2026-08-18T04:00:01.000Z',
    }),
    runEntry(4, runB, {
      kind: 'reasoning_progress',
      status: 'completed',
      text: 'Reasoning B',
      sequence: 2,
      created_at: '2026-08-18T04:00:01.000Z',
    }),
    runEntry(5, runA, {
      kind: 'assistant_text',
      text: 'Answer A',
      sequence: 3,
      created_at: '2026-08-18T04:00:02.000Z',
    }),
    runEntry(6, runB, {
      kind: 'assistant_text',
      text: 'Answer B',
      sequence: 3,
      created_at: '2026-08-18T04:00:02.000Z',
    }),
  ]);
  const reasoning = output.filter(
    (row) => row.event.kind === 'reasoning_progress',
  );
  const answers = output.filter((row) => row.event.kind === 'assistant_text');
  expect(reasoning).toHaveLength(2);
  expect(reasoning.map((row) => row.sourceOrdinals)).toEqual([
    [1, 3],
    [2, 4],
  ]);
  expect(answers).toHaveLength(2);
  expect(answers.map((row) => row.sourceOrdinals)).toEqual([[5], [6]]);
});

it('merges independent incremental assistant_text chunks into one row', () => {
  const input = [
    at(1, {
      kind: 'assistant_text',
      text: 'Hello, ',
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'assistant_text',
      text: 'world',
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'assistant_text',
      text: '!',
      sequence: 3,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  expect(output).toHaveLength(1);
  expect(
    (output[0].event as Extract<TranscriptEntry, { kind: 'assistant_text' }>)
      .text,
  ).toBe('Hello, world!');
  expect(output[0].sourceOrdinals).toEqual([1, 2, 3]);
});

it('still keeps only the latest cumulative-snapshot assistant_text (no regression)', () => {
  const input = [
    at(1, {
      kind: 'assistant_text',
      text: 'A',
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'assistant_text',
      text: 'AB',
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'assistant_text',
      text: 'ABC',
      sequence: 3,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  expect(output).toHaveLength(1);
  expect(
    (output[0].event as Extract<TranscriptEntry, { kind: 'assistant_text' }>)
      .text,
  ).toBe('ABC');
  expect(output[0].sourceOrdinals).toEqual([1, 2, 3]);
});

it('does not merge two real assistant_text turns separated by a tool call', () => {
  const input = [
    at(1, {
      kind: 'assistant_text',
      text: 'Let me check that file.',
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'tool_status',
      activity_id: 'read-1',
      category: 'read',
      status: 'completed',
      label: 'Read',
      summary: 'config.ts',
      provider: null,
      tool_name: null,
      detail_kind: 'read',
      detail_text: 'detail',
      exit_code: 0,
      parent_activity_id: null,
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'assistant_text',
      text: 'The file looks fine.',
      sequence: 3,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  const assistantRows = output.filter(
    (entry) => entry.event.kind === 'assistant_text',
  );
  expect(assistantRows).toHaveLength(2);
  expect(
    (
      assistantRows[0].event as Extract<
        TranscriptEntry,
        { kind: 'assistant_text' }
      >
    ).text,
  ).toBe('Let me check that file.');
  expect(
    (
      assistantRows[1].event as Extract<
        TranscriptEntry,
        { kind: 'assistant_text' }
      >
    ).text,
  ).toBe('The file looks fine.');
});

it('splices a cumulative snapshot that restarts part-way through a turn', () => {
  // Shape recorded from a real Claude WorkRun: the provider grows a cumulative
  // snapshot, then restarts it from a mid-sentence base and keeps growing that
  // tail. Appending each restarted snapshot repeated the tail once per event,
  // so a 1k-character answer rendered as 15k characters of repeated paragraphs.
  const input = [
    at(1, {
      kind: 'assistant_text',
      text: 'CPU 未饱和，但因无流量，此结论不能证',
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'assistant_text',
      text: '论不能证明容量健康。瓶颈与容量：',
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'assistant_text',
      text: '论不能证明容量健康。瓶颈与容量：窗口内实测 TPS = 0。',
      sequence: 3,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  expect(output).toHaveLength(1);
  expect(
    (output[0].event as Extract<TranscriptEntry, { kind: 'assistant_text' }>)
      .text,
  ).toBe(
    'CPU 未饱和，但因无流量，此结论不能证明容量健康。瓶颈与容量：窗口内实测 TPS = 0。',
  );
  expect(output[0].sourceOrdinals).toEqual([1, 2, 3]);
});

it('does not merge assistant_text across a runSegment (sequence rollback) boundary', () => {
  const input = [
    at(1, {
      kind: 'lifecycle',
      status: 'started',
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'assistant_text',
      text: 'Final answer from run one.',
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'lifecycle',
      status: 'started',
      sequence: 1,
      created_at: timestamp,
    }),
    at(4, {
      kind: 'assistant_text',
      text: 'Final answer from run two.',
      sequence: 2,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  const assistantRows = output.filter(
    (entry) => entry.event.kind === 'assistant_text',
  );
  expect(assistantRows).toHaveLength(2);
  expect(
    (
      assistantRows[0].event as Extract<
        TranscriptEntry,
        { kind: 'assistant_text' }
      >
    ).text,
  ).toBe('Final answer from run one.');
  expect(
    (
      assistantRows[1].event as Extract<
        TranscriptEntry,
        { kind: 'assistant_text' }
      >
    ).text,
  ).toBe('Final answer from run two.');
});

it('nests tool_status rows with parent_activity_id under their parent', () => {
  const input = [
    at(1, {
      kind: 'tool_status',
      activity_id: 'subagent-1',
      category: 'subagent',
      status: 'running',
      label: 'Sub-agent task',
      summary: null,
      provider: null,
      tool_name: null,
      detail_kind: null,
      detail_text: null,
      exit_code: null,
      parent_activity_id: null,
      sequence: 1,
      created_at: timestamp,
    }),
    at(2, {
      kind: 'tool_status',
      activity_id: 'inner-call-1',
      category: 'read',
      status: 'completed',
      label: 'Read',
      summary: 'file.ts',
      provider: null,
      tool_name: null,
      detail_kind: 'read',
      detail_text: 'file content',
      exit_code: 0,
      parent_activity_id: 'subagent-1',
      sequence: 2,
      created_at: timestamp,
    }),
    at(3, {
      kind: 'tool_status',
      activity_id: 'subagent-1',
      category: 'subagent',
      status: 'completed',
      label: 'Sub-agent task',
      summary: 'completed',
      provider: null,
      tool_name: null,
      detail_kind: null,
      detail_text: null,
      exit_code: 0,
      parent_activity_id: null,
      sequence: 3,
      created_at: timestamp,
    }),
  ];
  const output = projectTranscript(input);
  expect(output).toHaveLength(1);
  const parentRow = output[0];
  expect(parentRow.event.kind).toBe('tool_status');
  expect(
    (parentRow.event as Extract<TranscriptEntry, { kind: 'tool_status' }>)
      .activity_id,
  ).toBe('subagent-1');
  expect(parentRow.children).toBeDefined();
  expect(parentRow.children).toHaveLength(1);
  expect(
    (
      parentRow.children![0].event as Extract<
        TranscriptEntry,
        { kind: 'tool_status' }
      >
    ).activity_id,
  ).toBe('inner-call-1');
  expect(
    (
      parentRow.children![0].event as Extract<
        TranscriptEntry,
        { kind: 'tool_status' }
      >
    ).parent_activity_id,
  ).toBe('subagent-1');
});
