import { describe, expect, it, vi } from 'vitest';

import { PostgresExecutionFactQuery } from './postgres-execution-fact-query.js';

describe('PostgresExecutionFactQuery event history', () => {
  it('reads every run in pages and applies the stable cross-run display order', async () => {
    const rows = [
      event('run-b', 1, '2026-08-11T00:00:00.000Z'),
      event('run-a', 1, '2026-08-11T00:00:00.000Z'),
      event('run-a', 2, '2026-08-11T00:00:00.000Z'),
      event('run-a', 3, '2026-08-11T00:00:01.000Z'),
    ];
    const queryMock = vi.fn(
      async (_sql: string, values: readonly unknown[] | undefined) => {
        const [runId, , , after, limit] = values ?? [];
        return {
          rows: rows
            .filter(
              (row) =>
                row.run_id === runId && row.sequence > Number(after ?? 0),
            )
            .sort((left, right) => left.sequence - right.sequence)
            .slice(0, Number(limit)),
        };
      },
    );
    const database = {
      async query<Row>(sql: string, values?: readonly unknown[]) {
        const result = await queryMock(sql, values);
        return { rows: result.rows as Row[] };
      },
    };
    const facts = new PostgresExecutionFactQuery(database, {
      eventPageSize: 2,
    });

    const result = await facts.listRunEvents({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      runIds: ['run-b', 'run-a'],
    });

    expect(result.map(({ runId, sequence }) => [runId, sequence])).toEqual([
      ['run-a', 1],
      ['run-a', 2],
      ['run-b', 1],
      ['run-a', 3],
    ]);
    expect(
      queryMock.mock.calls.map(([, values]) => [values?.[0], values?.[3]]),
    ).toEqual([
      ['run-a', 0],
      ['run-a', 2],
      ['run-b', 0],
    ]);
  });

  it('fails explicitly instead of truncating at the page limit', async () => {
    const queryMock = vi.fn(async () => ({
      rows: [event('run-a', 1, '2026-08-11T00:00:00.000Z')],
    }));
    const database = {
      async query<Row>() {
        const result = await queryMock();
        return { rows: result.rows as Row[] };
      },
    };
    const facts = new PostgresExecutionFactQuery(database, {
      eventPageSize: 1,
      maxEventPagesPerRun: 1,
    });

    await expect(
      facts.listRunEvents({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        runIds: ['run-a'],
      }),
    ).rejects.toThrow('execution_event_page_limit_exceeded');
  });
});

function event(runId: string, sequence: number, createdAt: string) {
  return {
    id: `${runId}-${sequence}`,
    run_id: runId,
    sequence,
    type: 'output' as const,
    payload_present: true,
    created_at: createdAt,
  };
}
