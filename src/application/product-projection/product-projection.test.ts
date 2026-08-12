import { describe, expect, it } from 'vitest';

import type { ExecutionRunFact } from '../ports/execution-fact-query.js';
import { attemptTimingForRuns } from './product-projection.js';

const run = (overrides: Partial<ExecutionRunFact> = {}) =>
  ({
    runId: '00000000-0000-4000-8000-000000000001',
    taskId: '00000000-0000-4000-8000-000000000002',
    rootTaskId: '00000000-0000-4000-8000-000000000003',
    status: 'succeeded',
    provider: null,
    model: null,
    resultPresent: false,
    errorCode: null,
    actorId: null,
    workItemId: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  }) as ExecutionRunFact;

describe('Product Attempt timing cardinality', () => {
  it('fails closed for zero and multiple execution runs', () => {
    expect(attemptTimingForRuns([])).toEqual({
      started_at: null,
      ended_at: null,
      duration_ms: null,
      timing_capture_status: 'not_captured',
    });
    expect(
      attemptTimingForRuns([
        run(),
        run({ runId: '00000000-0000-4000-8000-000000000004' }),
      ]),
    ).toEqual({
      started_at: null,
      ended_at: null,
      duration_ms: null,
      timing_capture_status: 'not_captured',
    });
  });

  it('derives a one-run span from run_events timing facts', () => {
    expect(attemptTimingForRuns([run()])).toEqual({
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:01.000Z',
      duration_ms: 1000,
      timing_capture_status: 'captured',
    });
  });
});
