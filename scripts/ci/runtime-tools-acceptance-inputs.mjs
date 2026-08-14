import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

export async function requireRuntimeToolsCanonicalInputs() {
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
  console.log(
    JSON.stringify({
      guard: 'runtime-tools-canonical-inputs',
      kind: 'runtime-tools',
      cwd,
      database_variable: databaseVariable,
      database_reachable: databaseReachable,
      real_postgres_required: 'forced-by-raw-wrapper',
      package_present: packagePresent,
      node_modules_directory: nodeModules,
      pnpm_resolved: pnpmProbe.status === 0,
      pnpm_version: pnpmProbe.status === 0 ? pnpmProbe.stdout.trim() : null,
    }),
  );
  if (
    !databaseVariable ||
    !databaseReachable ||
    !packagePresent ||
    !nodeModules ||
    pnpmProbe.status !== 0
  ) {
    console.error(
      'RUNTIME_TOOLS_MISSING[runtime_tools_environment_unavailable]',
    );
    return false;
  }
  return true;
}

function safeDirectory(target) {
  try {
    return fs.lstatSync(target).isDirectory();
  } catch {
    return false;
  }
}
