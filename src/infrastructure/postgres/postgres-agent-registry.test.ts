import { describe, expect, it } from 'vitest';

import { InvalidAgentListCursorError } from '../../application/agents/errors.js';
import { PostgresAgentRegistry } from './postgres-agent-registry.js';

type Queryable = {
  query: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<{ rows?: readonly unknown[] }>;
};

function transaction<T>(
  registry: PostgresAgentRegistry,
  work: (db: Queryable) => Promise<T>,
) {
  return (
    registry as unknown as {
      transaction: (work: (db: Queryable) => Promise<T>) => Promise<T>;
    }
  ).transaction(work);
}

function cursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id]), 'utf8').toString(
    'base64url',
  );
}

describe('PostgresAgentRegistry transaction lifecycle', () => {
  it('releases a leased client when BEGIN fails without attempting rollback', async () => {
    const calls: string[] = [];
    let released = false;
    const beginError = new Error('begin failed');
    const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async (sql: string) => {
          calls.push(sql);
          if (sql === 'BEGIN') throw beginError;
          return { rows: [] };
        },
        release: () => {
          released = true;
        },
      }),
    };
    await expect(
      transaction(new PostgresAgentRegistry(pool), async () => 1),
    ).rejects.toBe(beginError);
    expect(released).toBe(true);
    expect(calls).toEqual(['BEGIN']);
  });

  it('preserves a work error when rollback also fails and releases the client', async () => {
    const calls: string[] = [];
    let released = false;
    const workError = new Error('work failed');
    const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async (sql: string) => {
          calls.push(sql);
          if (sql === 'ROLLBACK') throw new Error('rollback failed');
          return { rows: [] };
        },
        release: () => {
          released = true;
        },
      }),
    };
    await expect(
      transaction(new PostgresAgentRegistry(pool), async () => {
        throw workError;
      }),
    ).rejects.toBe(workError);
    expect(released).toBe(true);
    expect(calls).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('rolls back and preserves a COMMIT error', async () => {
    const calls: string[] = [];
    let released = false;
    const commitError = new Error('commit failed');
    const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async (sql: string) => {
          calls.push(sql);
          if (sql === 'COMMIT') throw commitError;
          return { rows: [] };
        },
        release: () => {
          released = true;
        },
      }),
    };
    await expect(
      transaction(new PostgresAgentRegistry(pool), async () => 1),
    ).rejects.toBe(commitError);
    expect(released).toBe(true);
    expect(calls).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
  });

  it('serializes query-only transactions per repository instance', async () => {
    let active = 0;
    let overlap = false;
    const database = {
      query: async (sql: string) => {
        if (sql === 'BEGIN') {
          active += 1;
          if (active > 1) overlap = true;
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') active -= 1;
        return { rows: [] };
      },
    };
    const registry = new PostgresAgentRegistry(database);
    await Promise.all([
      transaction(registry, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
      transaction(registry, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
    ]);
    expect(overlap).toBe(false);
  });
});

describe('PostgresAgentRegistry cursor validation', () => {
  it.each([
    ['hyphens', cursor('2026-07-23T10:00:00.000Z', '-'.repeat(36))],
    [
      'non-canonical timestamp',
      cursor('2026-07-23T10:00:00Z', '00000000-0000-4000-8000-000000000001'),
    ],
  ])('rejects %s before issuing SQL', async (_label, value) => {
    let queries = 0;
    const database = {
      query: async () => {
        queries += 1;
        return { rows: [] };
      },
    };
    const registry = new PostgresAgentRegistry(database);
    await expect(
      registry.listVersionsForOwner(
        {
          tenantId: 'tenant',
          principalType: 'service_account',
          principalId: 'principal',
        },
        {
          definitionId: '00000000-0000-4000-8000-000000000001',
          cursor: value,
          limit: 1,
        },
      ),
    ).rejects.toBeInstanceOf(InvalidAgentListCursorError);
    expect(queries).toBe(0);
  });
});
