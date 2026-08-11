#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import pg from 'pg';

const { Pool } = pg;
const VERSION = '0029_product_work_identity';
const TABLES = [
  'works',
  'work_runs',
  'work_run_resource_manifest',
];
const OWNER_COLUMNS = ['tenant_id', 'workspace_id', 'principal_type', 'principal_id'];
const migrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/infrastructure/postgres/migrations/0029_product_work_identity.sql',
);

const format = readFormat(process.argv.slice(2));
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  fail('DATABASE_URL or POSTGRES_URL is required.');
}

const pool = new Pool({ connectionString });
try {
  const evidence = await collectEvidence(pool);
  printEvidence(evidence, format);
} catch {
  // Keep connection details, SQL text, and driver errors out of operator output.
  fail('HG-2 evidence collection failed.');
} finally {
  await pool.end();
}

async function collectEvidence(database) {
  const migrationSha256 = createHash('sha256')
    .update(await readFile(migrationPath))
    .digest('hex');

  const registry = await database.query(
    `SELECT version, applied_at
       FROM durable_kernel_schema_migrations
      WHERE version = $1`,
    [VERSION],
  );
  const registryRow = registry.rows[0] ?? null;

  const columns = await database.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
        AND column_name = ANY($2::text[])
      ORDER BY table_name, ordinal_position`,
    [TABLES, OWNER_COLUMNS],
  );

  const constraints = await database.query(
    `SELECT c.relname AS table_name,
            con.conname AS name,
            CASE con.contype
              WHEN 'c' THEN 'check'
              WHEN 'f' THEN 'foreign_key'
              WHEN 'p' THEN 'primary_key'
              WHEN 'u' THEN 'unique'
              WHEN 'x' THEN 'exclusion'
              ELSE con.contype::text
            END AS kind,
            pg_get_constraintdef(con.oid, true) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname, con.conname`,
    [[...TABLES, 'workspaces']],
  );

  const indexes = await database.query(
    `SELECT tablename AS table_name, indexname AS name, indexdef AS definition
       FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = ANY($1::text[])
      ORDER BY tablename, indexname`,
    [[...TABLES, 'workspaces']],
  );

  const triggerChecks = await database.query(
    `SELECT conname AS name, pg_get_constraintdef(oid, true) AS definition
       FROM pg_constraint
      WHERE conrelid = 'work_runs'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid, true) ILIKE '%trigger_kind%'`,
  );

  const sourcePreflight = await database.query(
    `SELECT
       count(*) FILTER (WHERE tr.root_task_id IS NOT NULL)::bigint AS candidate_count,
       count(*) FILTER (
         WHERE tr.root_task_id IS NOT NULL
           AND w.id IS NULL
       )::bigint AS missing_workspace_uuid_count,
       count(*) FILTER (
         WHERE tr.root_task_id IS NOT NULL
           AND tv.id IS NULL
       )::bigint AS missing_team_version_count,
       count(*) FILTER (
         WHERE tr.root_task_id IS NOT NULL
           AND w.id IS NOT NULL
           AND tv.id IS NOT NULL
       )::bigint AS ready_count
       FROM team_runs tr
       LEFT JOIN team_versions tv ON tv.id = tr.team_version_id
       LEFT JOIN workspaces w
         ON w.id::text = tr.workspace_id
        AND w.tenant_id = tr.tenant_id`,
  );

  const counts = await database.query(
    `SELECT
       (SELECT count(*)::bigint FROM works) AS works,
       (SELECT count(*)::bigint FROM work_runs) AS work_runs,
       (SELECT count(*)::bigint FROM work_run_resource_manifest) AS manifests,
       (SELECT count(*)::bigint
          FROM work_runs
         WHERE root_task_id IS NULL
           AND expires_at <= now()) AS expired_pending`,
  );

  const source = sourcePreflight.rows[0];
  const tableCounts = counts.rows[0];
  const expiredPendingCount = numberValue(tableCounts.expired_pending);
  const candidateCount = numberValue(source.candidate_count);
  const missingWorkspaceUuidCount = numberValue(source.missing_workspace_uuid_count);
  const missingTeamVersionCount = numberValue(source.missing_team_version_count);
  const readyCount = numberValue(source.ready_count);

  return {
    evidence: 'HG-2 migration',
    generated_at: new Date().toISOString(),
    migration: {
      version: VERSION,
      registry_present: registryRow !== null,
      applied_at: registryRow?.applied_at ?? null,
      file_sha256: migrationSha256,
    },
    owner_columns: columns.rows.map((row) => ({
      table: row.table_name,
      column: row.column_name,
      data_type: row.data_type,
      udt: row.udt_name,
      nullable: row.is_nullable === 'YES',
    })),
    constraints: constraints.rows.map((row) => ({
      table: row.table_name,
      name: row.name,
      kind: row.kind,
      definition: row.definition,
    })),
    indexes: indexes.rows.map((row) => ({
      table: row.table_name,
      name: row.name,
      definition: row.definition,
    })),
    trigger_check: {
      expected: 'work_runs.trigger_kind CHECK',
      present: triggerChecks.rows.length > 0,
      definitions: triggerChecks.rows.map((row) => ({
        name: row.name,
        definition: row.definition,
      })),
    },
    backfill_source_preflight: {
      source: 'team_runs.root_task_id IS NOT NULL joined to team_versions and workspaces',
      candidate_count: candidateCount,
      ready_count: readyCount,
      missing_workspace_uuid_count: missingWorkspaceUuidCount,
      missing_team_version_count: missingTeamVersionCount,
      ready: missingWorkspaceUuidCount === 0 && missingTeamVersionCount === 0,
    },
    counts: {
      works: numberValue(tableCounts.works),
      work_runs: numberValue(tableCounts.work_runs),
      manifests: numberValue(tableCounts.manifests),
    },
    expired_pending_count: expiredPendingCount,
    checks: {
      registry_0029: registryRow !== null,
      owner_columns_present: columns.rows.length === TABLES.length * 2,
      trigger_check_present: triggerChecks.rows.length > 0,
      backfill_source_ready: missingWorkspaceUuidCount === 0 && missingTeamVersionCount === 0,
    },
  };
}

function readFormat(argv) {
  if (argv.includes('--ndjson') || argv.includes('--format=ndjson')) return 'ndjson';
  const formatArg = argv.find((arg) => arg.startsWith('--format='));
  if (formatArg && formatArg !== '--format=json') fail('format must be json or ndjson.');
  return 'json';
}

function printEvidence(evidence, outputFormat) {
  if (outputFormat === 'ndjson') {
    for (const [section, value] of Object.entries(evidence))
      process.stdout.write(`${JSON.stringify({ section, value })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

function numberValue(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('count is outside safe integer range');
  return number;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
