import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL is required\n');
  process.exit(2);
}
if (!process.argv.includes('--dry-run')) {
  process.stderr.write('Only --dry-run is supported\n');
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const tableExists = async (table) =>
  (
    await pool.query(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS present',
      ['public', table],
    )
  ).rows[0]?.present === true;
const count = async (table, sql) =>
  (await tableExists(table))
    ? Number((await pool.query(sql)).rows[0]?.count ?? 0)
    : 0;
try {
  const [
    nonterminalRuns,
    queuedDispatches,
    pendingMemoryProjections,
    failedMemoryProjections,
    snapshotsWithoutReadyProjection,
  ] = await Promise.all([
    count(
      'runs',
      "SELECT count(*) FROM runs WHERE status IN ('queued','running')",
    ),
    count(
      'run_dispatches',
      'SELECT count(*) FROM run_dispatches WHERE published_at IS NULL',
    ),
    count(
      'workspace_memory_snapshots',
      "SELECT count(*) FROM workspace_memory_snapshots WHERE projection_status = 'pending'",
    ),
    count(
      'workspace_memory_snapshots',
      "SELECT count(*) FROM workspace_memory_snapshots WHERE projection_status = 'failed'",
    ),
    count(
      'workspace_memory_snapshots',
      `SELECT count(*) FROM workspace_memory_snapshots s
      WHERE NOT EXISTS (
        SELECT 1 FROM workspace_memory_snapshots ready
        WHERE ready.tenant_id = s.tenant_id
          AND ready.workspace_id = s.workspace_id
          AND ready.projection_status = 'ready'
      )`,
    ),
  ]);
  process.stdout.write(
    JSON.stringify({
      mode: 'DRY_RUN',
      counts: {
        nonterminal_runs: nonterminalRuns,
        queued_dispatches: queuedDispatches,
        pending_memory_projections: pendingMemoryProjections,
        failed_memory_projections: failedMemoryProjections,
        snapshots_lacking_ready_projection: snapshotsWithoutReadyProjection,
      },
      classifications: {
        nonterminal_runs: nonterminalRuns ? 'present' : 'clear',
        queued_dispatches: queuedDispatches ? 'present' : 'clear',
        memory_projections:
          pendingMemoryProjections || failedMemoryProjections
            ? 'present'
            : 'clear',
        snapshots_lacking_ready_projection: snapshotsWithoutReadyProjection
          ? 'present'
          : 'clear',
      },
      runtime_receipt_reconciliation: 'unavailable',
    }) + '\n',
  );
} catch {
  process.stderr.write('Dry-run inspection failed\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
