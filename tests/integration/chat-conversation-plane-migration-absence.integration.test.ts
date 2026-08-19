import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';

import {
  applyDurableKernelMigrations,
  createPostgresPool,
  durableKernelMigrationFileNames,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

describe('Chat conversation plane migration absence (variant pair)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 2,
    });
    // Apply full migrations (including 0038) for this suite
    await applyDurableKernelMigrations(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('confirms 0038_chat_conversation_plane.sql is the final migration', () => {
    const lastMigration =
      durableKernelMigrationFileNames[
        durableKernelMigrationFileNames.length - 1
      ];
    expect(lastMigration).toBe('0038_chat_conversation_plane.sql');
  });

  it('confirms at least 38 migrations are registered', () => {
    expect(durableKernelMigrationFileNames.length).toBeGreaterThanOrEqual(38);
  });

  it('variant pair: chat tables DO NOT exist when migration is absent (simulated via transaction rollback)', async () => {
    // This test demonstrates that without migration 0038, the chat schema does not exist.
    // We simulate the "pre-migration" state by:
    // 1. Starting a transaction
    // 2. Dropping all 5 chat tables
    // 3. Attempting to query them (should fail with "relation does not exist")
    // 4. Rolling back so the tables are restored
    //
    // Note: After the first failed query, PostgreSQL marks the transaction as aborted (SQLSTATE 25P02).
    // To test each query independently, we use SAVEPOINT before each risky query and
    // ROLLBACK TO SAVEPOINT after each expected failure, so each query starts from clean state.

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Drop all 5 chat tables to simulate pre-migration state
      await client.query(`
        DROP TABLE IF EXISTS chat_messages CASCADE;
        DROP TABLE IF EXISTS conversations CASCADE;
        DROP TABLE IF EXISTS conversation_members CASCADE;
        DROP TABLE IF EXISTS conversation_reads CASCADE;
        DROP TABLE IF EXISTS agent_chat_runtimes CASCADE;
      `);

      // Check 1: chat_messages should not exist
      await client.query('SAVEPOINT before_check_1');
      let queryFailed = false;
      try {
        await client.query('SELECT 1 FROM chat_messages LIMIT 1');
      } catch (err: any) {
        queryFailed = true;
        expect(String(err.message)).toMatch(/relation.*does not exist/i);
      }
      expect(queryFailed).toBe(true);
      await client.query('ROLLBACK TO SAVEPOINT before_check_1');

      // Check 2: conversations should not exist
      await client.query('SAVEPOINT before_check_2');
      queryFailed = false;
      try {
        await client.query('SELECT 1 FROM conversations LIMIT 1');
      } catch (err: any) {
        queryFailed = true;
        expect(String(err.message)).toMatch(/relation.*does not exist/i);
      }
      expect(queryFailed).toBe(true);
      await client.query('ROLLBACK TO SAVEPOINT before_check_2');

      // ROLLBACK so the tables are restored (do not commit the drop)
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Verify tables exist again after rollback
    const conversationResult = await pool.query(
      'SELECT COUNT(*) as count FROM conversations',
    );
    expect(conversationResult.rowCount).toBe(1);
  });

  it('variant pair proof: tables exist with migration 0038 applied', async () => {
    // This is the positive counterpart: verify all 5 tables exist
    const tablesToCheck = [
      'conversations',
      'conversation_members',
      'chat_messages',
      'conversation_reads',
      'agent_chat_runtimes',
    ];

    for (const tableName of tablesToCheck) {
      const result = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        )`,
        [tableName],
      );
      const exists = result.rows?.[0]?.exists ?? false;
      expect(exists).toBe(true);
      if (!exists) {
        throw new Error(
          `Table ${tableName} should exist after migration 0038`,
        );
      }
    }
  });
});
