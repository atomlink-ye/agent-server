import { describe, expect, it } from 'vitest';

import type { ProductExecutionDetailEvent } from '@atomlink-ye/agent-server/product-contract';

import { outcomeBody, outcomeFromSessions } from './overview-pane';
import type { Session } from '@/features/run-trace/run-trace-gateway';
import type { TranscriptEntry } from '@/features/run-trace/transcript-projection';

const at = (
  ordinal: number,
  event: ProductExecutionDetailEvent,
): TranscriptEntry => ({ ...event, ordinal });
const timestamp = '2026-09-08T00:00:00.000Z';

function session(entries: readonly TranscriptEntry[]): Session {
  return {
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
  };
}

describe('Work outcome presentation', () => {
  it('keeps a one-line result as its complete document', () => {
    expect(outcomeBody('Done')).toBe('Done');
  });

  it('keeps the first line of a multi-paragraph result', () => {
    const outcome =
      'Investigation complete\n\nThe root cause was a stale binding.';
    expect(outcomeBody(outcome)).toBe(outcome);
  });

  it('keeps an explicit Markdown heading in the rendered result', () => {
    const outcome = '# Final report\n\n- Finding A\n- Finding B';
    expect(outcomeBody(outcome)).toBe(outcome);
  });

  it('uses the last merged assistant segment, even when it is shorter and starts mid-word', () => {
    const firstTurn =
      'That tool is only for `<path>` mode, not applicable to this run.'.padEnd(
        599,
        '.',
      );
    const secondTurn =
      'm having a background agent confirm exactly how this fixture worker is meant to signal completion before I do anything further.'.padEnd(
        251,
        '.',
      );
    expect(
      outcomeFromSessions([
        session([
          at(88, {
            kind: 'assistant_text',
            text: firstTurn.slice(0, 110),
            sequence: 88,
            created_at: timestamp,
          }),
          at(89, {
            kind: 'assistant_text',
            text: firstTurn.slice(0, 254),
            sequence: 89,
            created_at: timestamp,
          }),
          at(90, {
            kind: 'assistant_text',
            text: firstTurn.slice(0, 407),
            sequence: 90,
            created_at: timestamp,
          }),
          at(91, {
            kind: 'assistant_text',
            text: firstTurn,
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
            text: secondTurn.slice(0, 167),
            sequence: 93,
            created_at: timestamp,
          }),
          at(94, {
            kind: 'assistant_text',
            text: secondTurn,
            sequence: 94,
            created_at: timestamp,
          }),
        ]),
      ]),
    ).toBe(secondTurn);
  });

  it('does not combine separate assistant turns while choosing the outcome', () => {
    const firstTurn = 'That tool is only for `<path>` mode.';
    const secondTurn = 'm having a background agent confirm completion.';
    const outcome = outcomeFromSessions([
      session([
        at(91, {
          kind: 'assistant_text',
          text: firstTurn,
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
        at(94, {
          kind: 'assistant_text',
          text: secondTurn,
          sequence: 94,
          created_at: timestamp,
        }),
      ]),
    ]);
    expect(outcome).toBe(secondTurn);
    expect(outcome).not.toContain(firstTurn);
  });
});
