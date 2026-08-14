import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';
if (required && !connectionString)
  throw new Error('real PostgreSQL is required');
const describeRealPostgres = connectionString ? describe : describe.skip;

describeRealPostgres('real PostgreSQL migration concurrency', () => {
  const schema = `migration_concurrency_${crypto.randomUUID().replaceAll('-', '')}`;
  const decoySchema = `migration_decoy_${crypto.randomUUID().replaceAll('-', '')}`;
  let admin!: Pool;
  let first!: Pool;
  let second!: Pool;

  beforeAll(async () => {
    admin = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 1,
    });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`
      CREATE SCHEMA "${decoySchema}";
      CREATE TABLE "${decoySchema}".team_runs (
        id uuid NOT NULL,
        tenant_id text NOT NULL,
        workspace_id text NOT NULL,
        principal_type text NOT NULL,
        principal_id text NOT NULL,
        CONSTRAINT team_runs_id_owner_unique
          UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
      );
      CREATE TABLE "${decoySchema}".team_work_items (
        id uuid NOT NULL,
        team_run_id uuid NOT NULL,
        tenant_id text NOT NULL,
        workspace_id text NOT NULL,
        principal_type text NOT NULL,
        principal_id text NOT NULL,
        CONSTRAINT team_work_items_id_team_owner_unique
          UNIQUE (id, team_run_id, tenant_id, workspace_id, principal_type, principal_id)
      );
    `);
    first = new Pool({
      connectionString,
      max: 1,
      options: `-c search_path="${schema}"`,
    });
    second = new Pool({
      connectionString,
      max: 1,
      options: `-c search_path="${schema}"`,
    });
  });

  afterAll(async () => {
    await Promise.all([first?.end(), second?.end()]);
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.query(`DROP SCHEMA IF EXISTS "${decoySchema}" CASCADE`);
    await admin?.end();
  });

  it('converges concurrent migration application on a fresh isolated schema', async () => {
    await expect(
      Promise.all([
        applyDurableKernelMigrations(first),
        applyDurableKernelMigrations(second),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    await expect(
      admin.query(
        `SELECT version FROM "${schema}".durable_kernel_schema_migrations ORDER BY version`,
      ),
    ).resolves.toMatchObject({
      rows: expect.arrayContaining([{ version: '0013_channel_core' }]),
    });
    await expect(
      admin.query(
        `SELECT to_regclass('"${schema}".channel_ingress_events') AS table_name`,
      ),
    ).resolves.toMatchObject({
      rows: [{ table_name: `${schema}.channel_ingress_events` }],
    });
    await expect(
      admin.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid IN (
            '"${schema}".team_runs'::regclass,
            '"${schema}".team_work_items'::regclass
          )
            AND conname IN (
              'team_runs_id_owner_unique',
              'team_work_items_id_team_owner_unique'
            )
          ORDER BY conname`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { conname: 'team_runs_id_owner_unique' },
        { conname: 'team_work_items_id_team_owner_unique' },
      ],
    });
  });
});
