import { expect, it } from 'vitest';
import type { ProductExecutionDetailEvent } from '@atomlink-ye/agent-server/product-contract';

import type { Session } from '@/features/run-trace/run-trace-gateway';
import type { TranscriptEntry } from '@/features/run-trace/transcript-projection';
import { recentWorkRunSummary } from './run-outcome';

const timestamp = '2026-09-08T00:00:00.000Z';

const at = (
  ordinal: number,
  event: ProductExecutionDetailEvent,
): TranscriptEntry => ({ ...event, ordinal });

const transcriptSession = (entries: readonly TranscriptEntry[]): Session => ({
  label: {
    name: 'Fixture worker',
    role: null,
    status: 'completed',
    status_basis: 'agent_runs',
    source_refs: {},
  },
  summary: {
    status: 'completed',
    entry_count: entries.length,
    last_timestamp: timestamp,
    last_meaningful: null,
    work_refs: [],
    truncated: false,
  },
  entries,
});

const rawResultSummary = 'stale raw provider snapshot';

it('uses the latest merged assistant group for the recent Work summary', () => {
  const firstGroup = 'first assistant group'.padEnd(599, '.');
  const latestGroup = 'latest assistant group'.padEnd(251, '.');
  const summary = recentWorkRunSummary([
    transcriptSession([
      at(88, {
        kind: 'assistant_text',
        text: firstGroup.slice(0, 110),
        sequence: 88,
        created_at: timestamp,
      }),
      at(89, {
        kind: 'assistant_text',
        text: firstGroup.slice(0, 254),
        sequence: 89,
        created_at: timestamp,
      }),
      at(90, {
        kind: 'assistant_text',
        text: firstGroup.slice(0, 407),
        sequence: 90,
        created_at: timestamp,
      }),
      at(91, {
        kind: 'assistant_text',
        text: firstGroup,
        sequence: 91,
        created_at: timestamp,
      }),
      at(92, {
        kind: 'tool_status',
        activity_id: 'background-agent',
        category: 'subagent',
        status: 'completed',
        label: 'Background agent',
        summary: null,
        provider: null,
        tool_name: null,
        detail_kind: null,
        detail_text: null,
        exit_code: 0,
        parent_activity_id: null,
        sequence: 92,
        created_at: timestamp,
      }),
      at(93, {
        kind: 'assistant_text',
        text: latestGroup.slice(0, 167),
        sequence: 93,
        created_at: timestamp,
      }),
      at(94, {
        kind: 'assistant_text',
        text: latestGroup,
        sequence: 94,
        created_at: timestamp,
      }),
    ]),
  ]);

  expect(summary).toBe(latestGroup);
  expect(summary).not.toContain(firstGroup);
  expect(summary).not.toContain(rawResultSummary);
});
