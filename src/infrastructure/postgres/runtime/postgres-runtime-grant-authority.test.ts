import { describe, expect, it, vi } from 'vitest';
import { PostgresRuntimeGrantAuthority } from './postgres-runtime-grant-authority.js';

const input = {
  runtimeSessionId: 'runtime-session-1',
  generationId: 'generation-1',
  runtimeTurnId: 'turn-1',
} as never;

describe('PostgresRuntimeGrantAuthority rotation', () => {
  it('renews the selected grant for the current turn execution window', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const { authority, queries } = authorityWith({
      grants: [
        {
          id: 'grant-1',
          runtime_turn_id: 'turn-1',
          expires_at: '2026-08-24T00:05:00.000Z',
        },
      ],
      now,
    });

    await expect(authority.execute(input)).resolves.toEqual({
      kind: 'rotated',
    });
    const update = queries.find((query) =>
      query.sql.includes('SET runtime_turn_id'),
    );
    expect(update?.values).toEqual([
      'grant-1',
      'turn-1',
      now.toISOString(),
      '2026-08-24T00:15:00.000Z',
    ]);
  });

  it('renews an expired unrevoked bootstrap lineage grant when no active grant remains', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const { authority, queries } = authorityWith({
      grants: [
        {
          id: 'bootstrap-grant',
          runtime_turn_id: null,
          expires_at: '2026-08-23T23:59:00.000Z',
        },
      ],
      now,
    });

    await expect(authority.execute(input)).resolves.toEqual({
      kind: 'rotated',
    });
    expect(
      queries.filter((query) => query.sql.includes('SET runtime_turn_id')),
    ).toHaveLength(1);
  });

  it('fails closed when no active grant or bootstrap lineage exists', async () => {
    const { authority, queries } = authorityWith({
      grants: [
        {
          id: 'expired-bound-grant',
          runtime_turn_id: 'other-turn',
          expires_at: '2026-08-23T23:59:00.000Z',
        },
      ],
      now: new Date('2026-08-24T00:00:00.000Z'),
    });

    await expect(authority.execute(input)).resolves.toEqual({
      kind: 'denied',
      reason: 'runtime_grant_rotation_fenced',
    });
    expect(queries.some((query) => query.sql === 'COMMIT')).toBe(false);
  });

  it.each([
    ['generation_id', 'generation-1', 'revokeForGeneration'],
    ['runtime_turn_id', 'turn-1', 'revokeForTurn'],
    ['runtime_session_id', 'runtime-session-1', 'revokeForSession'],
  ] as const)(
    'revokes grants by durable %s lineage',
    async (column, id, method) => {
      const now = new Date('2026-08-24T00:00:00.000Z');
      const { authority, queries } = authorityWith({ grants: [], now });

      await authority[method](id as never);

      expect(queries.at(-1)).toEqual({
        sql: expect.stringContaining(
          `WHERE ${column}=$1 AND revoked_at IS NULL`,
        ),
        values: [id, now.toISOString()],
      });
    },
  );
});

function authorityWith(input: {
  readonly grants: readonly {
    readonly id: string;
    readonly runtime_turn_id: string | null;
    readonly expires_at: string;
  }[];
  readonly now: Date;
}) {
  const queries: Array<{
    sql: string;
    values?: readonly unknown[] | undefined;
  }> = [];
  const client = {
    query: vi.fn(
      async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        values?: readonly unknown[],
      ) => {
        queries.push({ sql, values });
        if (sql.startsWith('SELECT status FROM runtime_turns'))
          return { rows: [{ status: 'running' }] } as unknown as {
            rows: Row[];
          };
        if (sql.startsWith('SELECT id,runtime_turn_id,expires_at'))
          return { rows: input.grants } as unknown as { rows: Row[] };
        return { rows: [] as Row[], rowCount: 1 };
      },
    ),
    release: vi.fn(),
  };
  const database = {
    query: client.query,
    connect: vi.fn(async () => client),
  };
  return {
    authority: new PostgresRuntimeGrantAuthority(
      database as never,
      () => input.now,
    ),
    queries,
  };
}
