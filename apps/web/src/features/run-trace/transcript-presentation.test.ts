import { expect, it } from 'vitest';
import type { ProductExecutionDetailEvent } from '@atomlink-ye/agent-server/product-contract';

import { buildEntryPresentation } from './transcript-presentation';
import type { TranscriptEntry } from './transcript-projection';

const tool = (
  overrides: Partial<
    Extract<ProductExecutionDetailEvent, { kind: 'tool_status' }>
  >,
): TranscriptEntry => ({
  kind: 'tool_status',
  activity_id: 'activity-1',
  category: 'other',
  status: 'completed',
  label: 'Other activity',
  summary: 'Other activity.',
  provider: null,
  tool_name: null,
  detail_kind: null,
  detail_text: null,
  exit_code: 0,
  parent_activity_id: null,
  sequence: 1,
  created_at: '2026-08-18T04:00:00.000Z',
  ordinal: 1,
  ...overrides,
});

it('uses a captured command rather than a generic provider fallback', () => {
  expect(
    buildEntryPresentation(tool({ label: 'Other activity: pwd && ls -la' })),
  ).toMatchObject({ label: 'pwd && ls -la', summary: null });
});

it('uses a non-generic summary before a generic label', () => {
  expect(
    buildEntryPresentation(tool({ summary: 'Read src/index.ts' })),
  ).toMatchObject({ label: 'Read src/index.ts' });
});

it('falls back to the captured category when provider text is generic', () => {
  expect(
    buildEntryPresentation(
      tool({
        category: 'read',
        label: 'Read activity',
        summary: 'Read activity.',
      }),
    ),
  ).toMatchObject({ label: 'Read', summary: null });
});

it('renders captured assistant text under the captured actor name', () => {
  const event: TranscriptEntry = {
    kind: 'assistant_text',
    text: 'The answer from the Worker.',
    sequence: 4,
    created_at: '2026-08-18T04:00:00.000Z',
    ordinal: 4,
  };
  expect(
    buildEntryPresentation(event, { actorName: 'Worker Agent' }),
  ).toMatchObject({
    label: 'Worker Agent',
    summary: 'The answer from the Worker.',
    detailText: 'The answer from the Worker.',
    expandable: true,
  });
});

it('keeps the captured actor on a lifecycle row', () => {
  expect(
    buildEntryPresentation(
      {
        kind: 'lifecycle',
        status: 'started',
        ordinal: 1,
        sequence: 1,
        created_at: '2026-09-09T02:11:34.000Z',
      },
      { actorName: 'fixer' },
    ).label,
  ).toBe('fixer · Run started');
});
