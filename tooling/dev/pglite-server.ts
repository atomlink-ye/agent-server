import { rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite-smoke';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import { repositoryRoot } from './host-native.js';

/*
 * Why this exists: the host-native loop needs one predictable PostgreSQL wire
 * endpoint when a developer has no local server, without repository state or
 * a Docker dependency.
 * Design contract: the default endpoint is fixed at 127.0.0.1:55432 and its
 * durable database plus PID state live only under .local/dev-runtime. A stale
 * PID/state ownership claim is an error for the harness to report; this child
 * never silently adopts or repairs another process's state.
 * Design goals: make reuse explicit, keep fallback state disposable, and keep
 * real PostgreSQL semantics visibly outside this development-only server.
 */

export type PGliteState = Readonly<{
  kind: 'agent-server-pglite';
  pid: number;
  host: string;
  port: number;
  database: string;
  url: string;
  dataPath: string;
}>;

export async function writePGliteState(
  targetPath: string,
  state: PGliteState,
): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, targetPath);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

const host = process.env.PGLITE_HOST?.trim() || '127.0.0.1';
const port = Number.parseInt(process.env.PGLITE_PORT?.trim() || '55432', 10);
const dataPath = resolve(
  repositoryRoot,
  process.env.PGLITE_DATA_PATH?.trim() || '.local/dev-runtime/pglite',
);
const statePath = resolve(
  repositoryRoot,
  process.env.PGLITE_STATE_PATH?.trim() || '.local/dev-runtime/pglite.json',
);
const database = process.env.PGLITE_DATABASE?.trim() || 'postgres';
const url = `postgresql://postgres:postgres@${host}:${port}/${database}`;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PGLITE_PORT must be between 1 and 65535 (received ${port})`);
}

const db = new PGlite(dataPath);
const server = new PGLiteSocketServer({
  // pglite-socket 0.2.7 is paired with PGlite 0.5.x. The repository keeps that
  // version as @electric-sql/pglite-smoke while application tests use 0.3.x.
  db: db as never,
  host,
  port,
  maxConnections: 16,
});

let stopping = false;

async function removeState(): Promise<void> {
  await unlink(statePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.stop().catch(() => undefined);
  await db.close().catch(() => undefined);
  await removeState().catch(() => undefined);
}

async function start(): Promise<void> {
  await db.waitReady;
  await server.start();
  const state: PGliteState = {
    kind: 'agent-server-pglite',
    pid: process.pid,
    host,
    port,
    database,
    url,
    dataPath,
  };
  await writePGliteState(statePath, state);
  process.stdout.write(`host-native PGlite ready at ${url}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  start().catch((error: unknown) => {
    process.stderr.write(
      `host-native PGlite failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    void stop().finally(() => process.exit(1));
  });
}
