import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresRunEventRepository } from '../../src/infrastructure/postgres/postgres-run-event-repository.js';
import { createPostgresPool } from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';
if (required && !connectionString)
  throw new Error('real PostgreSQL is required');
const describeRealPostgres = connectionString ? describe : describe.skip;

describeRealPostgres('real PostgreSQL run event concurrency', () => {
  const schema = `run_event_concurrency_${randomUUID().replaceAll('-', '')}`;
  const appendCount = 64;
  let admin!: Pool;
  let pool!: Pool;

  beforeAll(async () => {
    admin = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 1,
    });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`
      CREATE TABLE "${schema}".run_events (
        id uuid PRIMARY KEY,
        run_id uuid NOT NULL,
        sequence bigint NOT NULL CHECK(sequence > 0),
        type text NOT NULL CHECK(type IN ('started','output','succeeded','failed','cancelled')),
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL,
        UNIQUE(run_id, sequence)
      );
    `);
    pool = new Pool({
      connectionString,
      max: appendCount,
      options: `-c search_path="${schema}"`,
    });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('allocates contiguous sequences for concurrent appends to one run', async () => {
    const runId = randomUUID();
    const repository = new PostgresRunEventRepository(pool);
    const expectedSequences = Array.from(
      { length: appendCount },
      (_, index) => index + 1,
    );

    const appended = await Promise.all(
      Array.from({ length: appendCount }, (_, index) =>
        repository.append(runId, 'output', { index }),
      ),
    );

    expect(appended).toHaveLength(appendCount);
    expect(appended.every((event) => event.runId === runId)).toBe(true);
    expect(
      appended.map((event) => event.sequence).sort((a, b) => a - b),
    ).toEqual(expectedSequences);

    const listed = await repository.list(runId, 0, appendCount + 1);
    expect(listed.events).toHaveLength(appendCount);
    expect(listed.events.map((event) => event.sequence)).toEqual(
      expectedSequences,
    );
    expect(new Set(listed.events.map((event) => event.sequence)).size).toBe(
      appendCount,
    );
    expect(listed.nextCursor).toBeNull();
  }, 30_000);
});
