import { describe, expect, it, vi } from 'vitest';
import { PostgresRuntimeGrantAuthority } from './postgres-runtime-grant-authority.js';

const input = {
  runtimeSessionId: 'runtime-session-1',
  generationId: 'generation-1',
  runtimeTurnId: 'turn-1',
} as {
  readonly runtimeSessionId: never;
  readonly generationId: never;
  readonly runtimeTurnId: never;
};

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

  it('reclaims and rotates a grant left bound to a turn that reached a terminal status', async () => {
    // releaseForTurn/revokeForTurn are in-process-only calls made after a
    // turn finishes; a crash between the turn going terminal and that call
    // leaves runtime_turn_id pointing at a turn that will never call either
    // again. That grant must remain reclaimable, not fence the generation.
    const now = new Date('2026-08-24T00:00:00.000Z');
    const { authority, queries } = authorityWith({
      grants: [
        {
          id: 'dead-turn-grant',
          runtime_turn_id: 'dead-turn',
          expires_at: '2026-08-24T00:05:00.000Z',
          bound_turn_status: 'succeeded',
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
      'dead-turn-grant',
      'turn-1',
      now.toISOString(),
      '2026-08-24T00:15:00.000Z',
    ]);
  });

  it('refuses to steal a grant bound to a different turn that is still live', async () => {
    // The reclaim path must never weaken this fence: a concurrent turn that
    // is genuinely still preparing/running keeps exclusive use of its grant.
    const { authority, queries } = authorityWith({
      grants: [
        {
          id: 'live-other-turn-grant',
          runtime_turn_id: 'other-turn',
          expires_at: '2026-08-24T00:05:00.000Z',
          bound_turn_status: 'running',
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

  it('classifies expiry correctly for a Date expires_at', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const { authority, queries } = authorityWith({
      grants: [
        {
          id: 'date-grant',
          runtime_turn_id: 'turn-1',
          expires_at: new Date('2026-08-24T00:05:00.000Z'),
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
      'date-grant',
      'turn-1',
      now.toISOString(),
      '2026-08-24T00:15:00.000Z',
    ]);
  });

  it('classifies expiry correctly for an already-expired Date expires_at', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const { authority, queries } = authorityWith({
      grants: [
        {
          id: 'expired-date-grant',
          runtime_turn_id: 'other-turn',
          expires_at: new Date('2026-08-23T23:59:00.000Z'),
          bound_turn_status: 'running',
        },
      ],
      now,
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

  it('fences the next turn until the prior turn releases its binding, then rebinds it', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    let boundTurn: string | null = null;
    let expiresAt = '2026-08-24T00:15:00.000Z';
    const client = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK')
          return { rows: [] };
        if (sql.startsWith('SELECT status FROM runtime_turns'))
          return { rows: [{ status: 'running' }] };
        if (sql.startsWith('SELECT g.id,g.runtime_turn_id,g.expires_at'))
          return {
            rows: [
              {
                id: 'grant-1',
                runtime_turn_id: boundTurn,
                expires_at: expiresAt,
                // turn-1 stays running (it never actually completes in this
                // scenario) until releaseForTurn clears the binding below.
                bound_turn_status: boundTurn === null ? null : 'running',
              },
            ],
          };
        if (sql.includes('SET runtime_turn_id=NULL')) {
          boundTurn = null;
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SET runtime_turn_id=$2,expires_at=$4')) {
          boundTurn = String(values?.[1]);
          expiresAt = String(values?.[3]);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const authority = new PostgresRuntimeGrantAuthority(
      { query: client.query, connect: vi.fn(async () => client) } as never,
      () => now,
    );

    await expect(
      authority.execute({ ...input, runtimeTurnId: 'turn-1' as never }),
    ).resolves.toEqual({ kind: 'rotated' });
    await expect(
      authority.execute({ ...input, runtimeTurnId: 'turn-2' as never }),
    ).resolves.toEqual({
      kind: 'denied',
      reason: 'runtime_grant_rotation_fenced',
    });
    await authority.releaseForTurn('turn-1' as never);
    await expect(
      authority.execute({ ...input, runtimeTurnId: 'turn-2' as never }),
    ).resolves.toEqual({ kind: 'rotated' });
  });
});

function authorityWith(input: {
  readonly grants: readonly {
    readonly id: string;
    readonly runtime_turn_id: string | null;
    readonly expires_at: string | Date;
    /**
     * Status of the turn runtime_turn_id points at, as it would come back
     * from the production LEFT JOIN. Defaults to 'running' for a bound
     * grant (matching every pre-existing fixture's implicit assumption)
     * and null for an unbound (bootstrap) grant.
     */
    readonly bound_turn_status?: string;
  }[];
  readonly now: Date;
}) {
  const queries: Array<{
    sql: string;
    values?: readonly unknown[] | undefined;
  }> = [];
  const rows = input.grants.map((grant) => ({
    id: grant.id,
    runtime_turn_id: grant.runtime_turn_id,
    expires_at: grant.expires_at,
    bound_turn_status:
      grant.bound_turn_status ??
      (grant.runtime_turn_id === null ? null : 'running'),
  }));
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
        if (sql.startsWith('SELECT g.id,g.runtime_turn_id,g.expires_at'))
          return { rows } as unknown as { rows: Row[] };
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
