#!/usr/bin/env node

import { createHash } from 'node:crypto';
import process from 'node:process';
import pg from 'pg';

const { Pool } = pg;
const DEFAULT_BATCH_SIZE = 100;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const batchSize = readBatchSize(process.argv);
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('DATABASE_URL or POSTGRES_URL is required.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString });
  try {
    const result = await backfill(pool, { batchSize, dryRun });
    console.log(
      `[backfill] complete inserted=${result.inserted} reused=${result.reused} conflicts=${result.conflicts}`,
    );
  } catch (error) {
    console.error(
      '[backfill] failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function readBatchSize(argv) {
  const index = argv.indexOf('--batch-size');
  if (index < 0) return DEFAULT_BATCH_SIZE;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('--batch-size must be a positive integer.');
  }
  return value;
}

async function backfill(pool, options) {
  let cursor = null;
  const totals = { inserted: 0, reused: 0, conflicts: 0 };
  for (;;) {
    const rows = await loadTeamRuns(pool, cursor, options.batchSize);
    if (rows.length === 0) break;
    const batchResult = options.dryRun
      ? await inspectBatch(pool, rows)
      : await writeBatch(pool, rows);
    totals.inserted += batchResult.inserted;
    totals.reused += batchResult.reused;
    totals.conflicts += batchResult.conflicts;
    cursor = rows.at(-1);
    console.log(
      `[backfill] cursor tenant=${cursor.tenant_id} workspace=${cursor.workspace_id} created_at=${cursor.created_at.toISOString?.() ?? cursor.created_at} id=${cursor.id} inserted=${batchResult.inserted} reused=${batchResult.reused} conflicts=${batchResult.conflicts}`,
    );
  }
  return totals;
}

async function loadTeamRuns(pool, cursor, limit) {
  const values = [];
  let where = 'tr.root_task_id IS NOT NULL';
  if (cursor) {
    values.push(
      cursor.tenant_id,
      cursor.workspace_id,
      cursor.created_at,
      cursor.id,
    );
    where += ` AND (tr.tenant_id, tr.workspace_id, tr.created_at, tr.id)
      > ($${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length})`;
  }
  values.push(limit);
  const result = await pool.query(
    `SELECT tr.id, tr.tenant_id, tr.workspace_id, w.id AS workspace_uuid,
            tr.root_task_id, tr.team_version_id,
            tr.created_at, tv.definition_id
       FROM team_runs tr
       JOIN team_versions tv ON tv.id = tr.team_version_id
       LEFT JOIN workspaces w ON w.id::text = tr.workspace_id AND w.tenant_id = tr.tenant_id
      WHERE ${where}
      ORDER BY tr.tenant_id, tr.workspace_id, tr.created_at, tr.id
      LIMIT $${values.length}`,
    values,
  );
  const invalid = result.rows.find((row) => !row.workspace_uuid);
  if (invalid)
    throw new Error(
      `Backfill preflight conflict: legacy workspace ${invalid.workspace_id} is not a UUID workspace in tenant ${invalid.tenant_id}.`,
    );
  return result.rows;
}

async function inspectBatch(pool, rows) {
  let inserted = 0;
  let reused = 0;
  let conflicts = 0;
  for (const row of rows) {
    const identity = await readExisting(pool, row);
    if (!identity) inserted += 1;
    else if (identityMatches(identity, row)) reused += 1;
    else conflicts += 1;
  }
  if (conflicts > 0)
    throw new Error('Backfill conflict detected during dry-run.');
  return { inserted, reused, conflicts };
}

async function writeBatch(pool, rows) {
  const client = await pool.connect();
  const result = { inserted: 0, reused: 0, conflicts: 0 };
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const outcome = await writeOne(client, row);
      result[outcome] += 1;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function writeOne(client, row) {
  const workId = deterministicUuid(`legacy-work:${row.id}`);
  const workRunId = deterministicUuid(`legacy-work-run:${row.id}`);
  const triggerKind = 'manual';
  const triggerRef = `backfill:${row.id}`;
  const idempotencyKey = sha256(`${workId}\0${triggerKind}\0${triggerRef}`);
  const createdAt = asIso(row.created_at);
  const work = await client.query(
    `INSERT INTO works
       (id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,archived_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'backfilled',NULL,$7,$7)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      workId,
      row.tenant_id,
      row.workspace_uuid,
      row.definition_id,
      row.team_version_id,
      `Backfilled work ${row.id}`,
      createdAt,
    ],
  );
  const existingWork = await client.query(
    `SELECT id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,archived_at,created_at,updated_at
       FROM works WHERE id=$1`,
    [workId],
  );
  if (
    !existingWork.rows[0] ||
    !workEquivalent(existingWork.rows[0], row, workId)
  ) {
    throw new Error(`work identity conflict for legacy team run ${row.id}`);
  }

  const run = await client.query(
    `INSERT INTO work_runs
       (id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,root_task_id,expires_at,bound_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10,$10)
     ON CONFLICT (tenant_id,workspace_id,idempotency_key) DO NOTHING
     RETURNING id`,
    [
      workRunId,
      row.tenant_id,
      row.workspace_uuid,
      workId,
      row.team_version_id,
      triggerKind,
      triggerRef,
      idempotencyKey,
      row.root_task_id,
      createdAt,
    ],
  );
  const existingRun = await client.query(
    `SELECT id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,root_task_id,expires_at,bound_at,created_at,updated_at,
            (SELECT COUNT(*) FROM work_runs all_runs WHERE all_runs.work_id=work_runs.work_id) AS run_count
       FROM work_runs WHERE tenant_id=$1 AND workspace_id=$2 AND idempotency_key=$3`,
    [row.tenant_id, row.workspace_uuid, idempotencyKey],
  );
  if (
    !existingRun.rows[0] ||
    !runEquivalent(existingRun.rows[0], row, workId, workRunId, idempotencyKey)
  ) {
    throw new Error(`work run identity conflict for legacy team run ${row.id}`);
  }

  await client.query(
    `INSERT INTO work_run_resource_manifest
       (work_run_id,tenant_id,workspace_id,slot,resource_kind,requested_ref,resolved_version_id,resolved_fingerprint,resolved_at)
     VALUES ($1,$2,$3,'definition','definition',$4,$5,NULL,$6)
     ON CONFLICT (work_run_id,slot) DO NOTHING`,
    [
      workRunId,
      row.tenant_id,
      row.workspace_uuid,
      `team_version:${row.team_version_id}`,
      row.team_version_id,
      createdAt,
    ],
  );
  const existingManifest = await client.query(
    `SELECT slot,resource_kind,requested_ref,resolved_version_id,resolved_fingerprint,resolved_at
       FROM work_run_resource_manifest WHERE work_run_id=$1 ORDER BY slot`,
    [workRunId],
  );
  const manifest = existingManifest.rows[0];
  if (
    existingManifest.rows.length !== 1 ||
    !manifest ||
    manifest.slot !== 'definition' ||
    manifest.resource_kind !== 'definition' ||
    manifest.requested_ref !== `team_version:${row.team_version_id}` ||
    manifest.resolved_version_id !== row.team_version_id ||
    manifest.resolved_fingerprint !== null ||
    asIso(manifest.resolved_at) !== createdAt
  ) {
    throw new Error(`manifest identity conflict for legacy team run ${row.id}`);
  }
  return work.rows[0] && run.rows[0] ? 'inserted' : 'reused';
}

async function readExisting(pool, row) {
  const workId = deterministicUuid(`legacy-work:${row.id}`);
  const result = await pool.query(
    `SELECT w.id, w.tenant_id, w.workspace_id, w.definition_id, w.current_definition_version_id,
            w.title, w.origin, w.archived_at, w.created_at AS work_created_at, w.updated_at AS work_updated_at,
            wr.id AS work_run_id, wr.work_id, wr.definition_version_id,
            wr.trigger_kind, wr.trigger_ref, wr.idempotency_key, wr.root_task_id,
            wr.expires_at, wr.bound_at, wr.created_at AS run_created_at, wr.updated_at AS run_updated_at,
            COUNT(wr.id) OVER (PARTITION BY w.id) AS run_count
       FROM works w LEFT JOIN work_runs wr ON wr.work_id=w.id
      WHERE w.id=$1`,
    [workId],
  );
  const identity = result.rows[0];
  if (!identity) return null;
  const manifest = await pool.query(
    `SELECT slot,resource_kind,requested_ref,resolved_version_id,resolved_fingerprint,resolved_at
       FROM work_run_resource_manifest WHERE work_run_id=$1 ORDER BY slot`,
    [identity.work_run_id],
  );
  return { ...identity, manifest: manifest.rows };
}

function identityMatches(identity, row) {
  const workId = deterministicUuid(`legacy-work:${row.id}`);
  const workRunId = deterministicUuid(`legacy-work-run:${row.id}`);
  const triggerRef = `backfill:${row.id}`;
  return (
    identity.id === workId &&
    identity.tenant_id === row.tenant_id &&
    identity.workspace_id === row.workspace_uuid &&
    identity.definition_id === row.definition_id &&
    identity.current_definition_version_id === row.team_version_id &&
    identity.origin === 'backfilled' &&
    identity.archived_at === null &&
    asIso(identity.work_created_at) === asIso(row.created_at) &&
    asIso(identity.work_updated_at) === asIso(row.created_at) &&
    identity.work_run_id === workRunId &&
    Number(identity.run_count) === 1 &&
    identity.work_id === workId &&
    identity.definition_version_id === row.team_version_id &&
    identity.trigger_kind === 'manual' &&
    identity.trigger_ref === triggerRef &&
    identity.idempotency_key === sha256(`${workId}\0manual\0${triggerRef}`) &&
    identity.root_task_id === row.root_task_id &&
    asIso(identity.expires_at) === asIso(row.created_at) &&
    asIso(identity.bound_at) === asIso(row.created_at) &&
    asIso(identity.run_created_at) === asIso(row.created_at) &&
    asIso(identity.run_updated_at) === asIso(row.created_at) &&
    identity.manifest.length === 1 &&
    identity.manifest[0].slot === 'definition' &&
    identity.manifest[0].resource_kind === 'definition' &&
    identity.manifest[0].requested_ref ===
      `team_version:${row.team_version_id}` &&
    identity.manifest[0].resolved_version_id === row.team_version_id &&
    identity.manifest[0].resolved_fingerprint === null &&
    asIso(identity.manifest[0].resolved_at) === asIso(row.created_at)
  );
}

function workEquivalent(work, row, workId) {
  return (
    work.id === workId &&
    work.tenant_id === row.tenant_id &&
    work.workspace_id === row.workspace_uuid &&
    work.definition_id === row.definition_id &&
    work.current_definition_version_id === row.team_version_id &&
    work.title === `Backfilled work ${row.id}` &&
    work.origin === 'backfilled' &&
    work.archived_at === null &&
    asIso(work.created_at) === asIso(row.created_at) &&
    asIso(work.updated_at) === asIso(row.created_at)
  );
}

function runEquivalent(run, row, workId, workRunId, idempotencyKey) {
  return (
    Number(run.run_count) === 1 &&
    run.id === workRunId &&
    run.tenant_id === row.tenant_id &&
    run.workspace_id === row.workspace_uuid &&
    run.work_id === workId &&
    run.definition_version_id === row.team_version_id &&
    run.trigger_kind === 'manual' &&
    run.trigger_ref === `backfill:${row.id}` &&
    run.idempotency_key === idempotencyKey &&
    run.root_task_id === row.root_task_id &&
    asIso(run.expires_at) === asIso(row.created_at) &&
    asIso(run.bound_at) === asIso(row.created_at) &&
    asIso(run.created_at) === asIso(row.created_at) &&
    asIso(run.updated_at) === asIso(row.created_at)
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deterministicUuid(value) {
  const bytes = createHash('sha256').update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function asIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}
