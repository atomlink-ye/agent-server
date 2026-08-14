import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

export async function requireCanonicalInputs({ kind, environmentMarker }) {
  const cwd = process.cwd();
  const databaseVariable = process.env.DATABASE_URL
    ? 'DATABASE_URL'
    : process.env.POSTGRES_URL
      ? 'POSTGRES_URL'
      : null;
  const packagePresent = fs.existsSync(path.join(cwd, 'package.json'));
  const nodeModules = safeDirectory(path.join(cwd, 'node_modules'));
  const pnpmProbe = spawnSync('pnpm', ['--version'], {
    cwd,
    env: process.env,
    encoding: 'utf8',
  });
  let databaseReachable = false;
  if (databaseVariable) {
    const pool = new pg.Pool({
      connectionString: process.env[databaseVariable],
    });
    try {
      await pool.query('SELECT 1');
      databaseReachable = true;
    } catch {
      databaseReachable = false;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
  const inputs = {
    guard: 'work-acceptance-canonical-inputs',
    kind,
    cwd,
    database_variable: databaseVariable,
    database_reachable: databaseReachable,
    real_postgres_required: 'forced-by-raw-wrapper',
    package_present: packagePresent,
    node_modules_directory: nodeModules,
    pnpm_resolved: pnpmProbe.status === 0,
    pnpm_version: pnpmProbe.status === 0 ? pnpmProbe.stdout.trim() : null,
  };
  console.log(JSON.stringify(inputs));
  if (
    !databaseVariable ||
    !databaseReachable ||
    !packagePresent ||
    !nodeModules ||
    pnpmProbe.status !== 0
  ) {
    console.error(`WORK_ACCEPTANCE_MISSING[${environmentMarker}]`);
    return false;
  }
  return true;
}

export function runVitestTarget({ kind, zeroExecutionMarker, pattern }) {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), `work-acceptance-${kind}-`),
  );
  const resultFile = path.join(temp, 'vitest.json');
  try {
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.integration.config.ts',
        '--no-file-parallelism',
        'tests/integration/product-api-v1-oi38.integration.test.ts',
        '-t',
        pattern,
        '--reporter=json',
        '--outputFile',
        resultFile,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, REAL_POSTGRES_REQUIRED: '1' },
        encoding: 'utf8',
      },
    );
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    let report;
    try {
      report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    } catch {
      console.error(`WORK_ACCEPTANCE_MISSING[${zeroExecutionMarker}]`);
      return 1;
    }
    const executed =
      Number(report.numPassedTests ?? 0) + Number(report.numFailedTests ?? 0);
    console.log(
      JSON.stringify({
        guard: 'work-acceptance-target-execution',
        kind,
        passed: Number(report.numPassedTests ?? 0),
        failed: Number(report.numFailedTests ?? 0),
        pending: Number(report.numPendingTests ?? 0),
        executed,
      }),
    );
    if (executed === 0) {
      console.error(`WORK_ACCEPTANCE_MISSING[${zeroExecutionMarker}]`);
      return 1;
    }
    return result.status === null || result.signal || result.error
      ? 1
      : result.status;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function safeDirectory(target) {
  try {
    return fs.lstatSync(target).isDirectory();
  } catch {
    return false;
  }
}
