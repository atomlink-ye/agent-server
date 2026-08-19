import { expect, it } from 'vitest';
import type { ProductExecutionDetailEvent } from '@atomlink-ye/agent-server/product-contract';

import { projectTranscript, type TranscriptEntry } from './transcript-projection';

const at = (ordinal: number, event: ProductExecutionDetailEvent): TranscriptEntry => ({ ...event, ordinal });
const timestamp = '2026-08-18T04:00:00.000Z';

it('preserves every source ordinal while compacting a transcript', () => {
  const input = [
    at(1, { kind: 'reasoning_progress', status: 'started', text: null, sequence: 1, created_at: timestamp }),
    at(2, { kind: 'reasoning_progress', status: 'completed', text: 'thought', sequence: 2, created_at: timestamp }),
    at(3, { kind: 'tool_status', activity_id: 'read-1', category: 'read', status: 'running', label: 'Read', summary: null, provider: null, tool_name: null, detail_kind: null, detail_text: null, exit_code: null, parent_activity_id: null, sequence: 3, created_at: timestamp }),
    at(4, { kind: 'tool_status', activity_id: 'read-1', category: 'read', status: 'completed', label: 'Read', summary: 'config.ts', provider: null, tool_name: null, detail_kind: 'read', detail_text: 'detail', exit_code: 0, parent_activity_id: null, sequence: 4, created_at: timestamp }),
    at(5, { kind: 'assistant_text', text: 'A', sequence: 5, created_at: timestamp }),
    at(6, { kind: 'assistant_text', text: 'AB', sequence: 6, created_at: timestamp }),
  ];
  const output = projectTranscript(input);
  expect(output.flatMap((entry) => entry.sourceOrdinals).sort((a, b) => a - b)).toEqual(input.map((entry) => entry.ordinal).sort((a, b) => a - b));
});

it('does not swallow a later run after a lifecycle terminal event', () => {
  const input = [
    at(1, { kind: 'lifecycle', status: 'started', sequence: 1, created_at: timestamp }),
    at(2, { kind: 'assistant_text', text: 'first', sequence: 2, created_at: timestamp }),
    at(3, { kind: 'lifecycle', status: 'succeeded', sequence: 3, created_at: timestamp }),
    at(4, { kind: 'assistant_text', text: 'second', sequence: 1, created_at: timestamp }),
    at(5, { kind: 'lifecycle', status: 'started', sequence: 2, created_at: timestamp }),
  ];
  const output = projectTranscript(input);
  expect(output.flatMap((entry) => entry.sourceOrdinals)).toEqual(expect.arrayContaining([4, 5]));
});

it('does not merge the same provider activity id across sequence-reset runs', () => {
  const input = [
    at(1, { kind: 'lifecycle', status: 'started', sequence: 1, created_at: timestamp }),
    at(2, { kind: 'tool_status', activity_id: 'activity-3', category: 'read', status: 'completed', label: 'Read', summary: 'first.ts', provider: null, tool_name: null, detail_kind: 'read', detail_text: 'first detail', exit_code: 0, parent_activity_id: null, sequence: 3, created_at: timestamp }),
    at(3, { kind: 'lifecycle', status: 'succeeded', sequence: 4, created_at: timestamp }),
    at(4, { kind: 'lifecycle', status: 'started', sequence: 1, created_at: timestamp }),
    at(5, { kind: 'tool_status', activity_id: 'activity-3', category: 'shell', status: 'completed', label: 'Shell', summary: 'second command', provider: null, tool_name: null, detail_kind: 'shell', detail_text: 'second detail', exit_code: 0, parent_activity_id: null, sequence: 3, created_at: timestamp }),
  ];
  const tools = projectTranscript(input).filter((entry) => entry.event.kind === 'tool_status');
  expect(tools).toHaveLength(2);
  expect(tools.map((entry) => entry.sourceOrdinals)).toEqual([[2], [5]]);
});

it('nests tool_status rows with parent_activity_id under their parent', () => {
  const input = [
    at(1, { kind: 'tool_status', activity_id: 'subagent-1', category: 'subagent', status: 'running', label: 'Sub-agent task', summary: null, provider: null, tool_name: null, detail_kind: null, detail_text: null, exit_code: null, parent_activity_id: null, sequence: 1, created_at: timestamp }),
    at(2, { kind: 'tool_status', activity_id: 'inner-call-1', category: 'read', status: 'completed', label: 'Read', summary: 'file.ts', provider: null, tool_name: null, detail_kind: 'read', detail_text: 'file content', exit_code: 0, parent_activity_id: 'subagent-1', sequence: 2, created_at: timestamp }),
    at(3, { kind: 'tool_status', activity_id: 'subagent-1', category: 'subagent', status: 'completed', label: 'Sub-agent task', summary: 'completed', provider: null, tool_name: null, detail_kind: null, detail_text: null, exit_code: 0, parent_activity_id: null, sequence: 3, created_at: timestamp }),
  ];
  const output = projectTranscript(input);
  expect(output).toHaveLength(1);
  const parentRow = output[0];
  expect(parentRow.event.kind).toBe('tool_status');
  expect((parentRow.event as Extract<TranscriptEntry, { kind: 'tool_status' }>).activity_id).toBe('subagent-1');
  expect(parentRow.children).toBeDefined();
  expect(parentRow.children).toHaveLength(1);
  expect((parentRow.children![0].event as Extract<TranscriptEntry, { kind: 'tool_status' }>).activity_id).toBe('inner-call-1');
  expect((parentRow.children![0].event as Extract<TranscriptEntry, { kind: 'tool_status' }>).parent_activity_id).toBe('subagent-1');
});
