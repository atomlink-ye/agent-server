import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, readFile, unlink } from 'node:fs/promises';
import { closeSync, constants, openSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection, createServer } from 'node:net';

import { Pool } from 'pg';

import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export const LOCAL_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_SERVICE_TOKEN = 'token-local-dev';

const PGLITE_HOST = '127.0.0.1';
const PGLITE_DEFAULT_PORT = 55_432;
const PGLITE_DATABASE = 'postgres';
const PGLITE_STATE_PATH = resolve(
  repositoryRoot,
  '.local/dev-runtime/pglite.json',
);
const PGLITE_DATA_PATH = resolve(repositoryRoot, '.local/dev-runtime/pglite');

type PGliteState = Readonly<{
  kind: 'agent-server-pglite';
  pid: number;
  host: string;
  port: number;
  database: string;
  url: string;
  dataPath: string;
}>;

export type HostDatabaseBackend = 'pglite' | 'postgres';

export function localServiceAccountsJson(): string {
  return JSON.stringify([
    {
      serviceAccountId: 'svc_local',
      token: LOCAL_SERVICE_TOKEN,
      tenantId: 'tenant_local',
      workspaceId: LOCAL_WORKSPACE_ID,
      policyVersion: 'policy-local',
    },
    {
      serviceAccountId: 'svc_local_2',
      token: 'token-local-dev-2',
      tenantId: 'tenant_local_2',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      policyVersion: 'policy-local-2',
    },
  ]);
}

export async function loadLocalDotEnv(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const result = { ...environment };
  for (const fileName of ['.env', '.env.local']) {
    let contents: string;
    try {
      contents = await readFile(resolve(repositoryRoot, fileName), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!match) continue;
      const name = match[1]!;
      if (result[name]?.trim()) continue;
      let value = match[2]!.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[name] = value;
    }
  }
  return result;
}

export function defaultHostDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.DATABASE_URL?.trim()) return environment.DATABASE_URL.trim();
  if (environment.POSTGRES_URL?.trim()) return environment.POSTGRES_URL.trim();
  const username = environment.PGUSER?.trim() || userInfo().username;
  return `postgresql://${encodeURIComponent(username)}@127.0.0.1:5432/agent_server_dev`;
}

export function hostCoreEnvironment(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const databaseUrl = defaultHostDatabaseUrl(base);
  return {
    ...base,
    DATABASE_URL: databaseUrl,
    POSTGRES_URL: databaseUrl,
    POSTGRES_ADMIN_URL: databaseUrl,
    NODE_ENV: base.NODE_ENV ?? 'development',
    HOST: base.HOST ?? '127.0.0.1',
    PORT: base.PORT ?? '3000',
    SERVICE_ACCOUNTS_JSON:
      base.SERVICE_ACCOUNTS_JSON?.trim() || localServiceAccountsJson(),
    AGENT_SERVER_DIRECT_CHAT_PLANE:
      base.AGENT_SERVER_DIRECT_CHAT_PLANE?.trim() || 'mock',
    AGENT_SERVER_PRODUCT_WORK_PLANE:
      base.AGENT_SERVER_PRODUCT_WORK_PLANE?.trim() || 'absent',
    RUNTIME_ADAPTER: 'none',
    AGENT_SERVER_SKILL_REGISTRY_ROOT:
      base.AGENT_SERVER_SKILL_REGISTRY_ROOT?.trim() || '.local/skill-registry',
    PASEO_AGENT_CWD: base.PASEO_AGENT_CWD?.trim() || '.local/agent-workspace',
    PASEO_RUNTIME_CELL_ROOT:
      base.PASEO_RUNTIME_CELL_ROOT?.trim() || '.local/runtime-cells',
  };
}

export function hostRuntimeEnvironment(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const databaseUrl = defaultHostDatabaseUrl(base);
  return {
    ...base,
    DATABASE_URL: databaseUrl,
    POSTGRES_URL: databaseUrl,
    POSTGRES_ADMIN_URL: databaseUrl,
    NODE_ENV: base.NODE_ENV ?? 'development',
    HOST: base.HOST ?? '127.0.0.1',
    PORT: base.PORT ?? '3000',
    SERVICE_ACCOUNTS_JSON:
      base.SERVICE_ACCOUNTS_JSON?.trim() || localServiceAccountsJson(),
    AGENT_SERVER_DIRECT_CHAT_PLANE: 'execution_runtime',
    AGENT_SERVER_PRODUCT_WORK_PLANE: 'execution_runtime',
    RUNTIME_ADAPTER: 'paseo',
    AGENT_SERVER_SKILL_REGISTRY_ROOT:
      base.AGENT_SERVER_SKILL_REGISTRY_ROOT?.trim() || '.local/skill-registry',
    PASEO_AGENT_CWD: base.PASEO_AGENT_CWD?.trim() || '.local/agent-workspace',
    PASEO_RUNTIME_CELL_ROOT:
      base.PASEO_RUNTIME_CELL_ROOT?.trim() || '.local/runtime-cells',
  };
}

export function hostWebEnvironment(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...base,
    AGENT_SERVER_BASE_URL:
      base.AGENT_SERVER_BASE_URL?.trim() || 'http://127.0.0.1:3000',
    AGENT_SERVER_SERVICE_TOKEN:
      base.AGENT_SERVER_SERVICE_TOKEN?.trim() || LOCAL_SERVICE_TOKEN,
    WEB_WORKSPACE_ID: base.WEB_WORKSPACE_ID?.trim() || LOCAL_WORKSPACE_ID,
  };
}

export async function ensureLocalDirectories(): Promise<void> {
  await Promise.all(
    [
      '.local/agent-workspace',
      '.local/runtime-cells',
      '.local/skill-registry',
      '.local/home',
      '.local/dev-runtime',
      '.local/canary',
    ].map((path) => mkdir(resolve(repositoryRoot, path), { recursive: true })),
  );
}

export async function commandAvailable(command: string): Promise<boolean> {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  return new Promise<boolean>((resolveAvailable) => {
    const child = spawn(lookup, [command], { stdio: 'ignore' });
    child.once('error', () => resolveAvailable(false));
    child.once('exit', (code) => resolveAvailable(code === 0));
  });
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly stdio?: 'inherit' | 'ignore';
  } = {},
): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? repositoryRoot,
      env: options.environment ?? process.env,
      stdio: options.stdio ?? 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited ${code ?? signal ?? 'unknown'}`));
    });
  });
}

export async function connectablePostgres(
  connectionString: string,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 1_500 });
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function ensureDevelopmentDatabase(
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const connectionString = defaultHostDatabaseUrl(environment);
  const initial = await connectablePostgres(connectionString);
  if (initial.ok) return connectionString;

  const explicitlyConfigured = Boolean(
    environment.DATABASE_URL?.trim() || environment.POSTGRES_URL?.trim(),
  );
  if (explicitlyConfigured) {
    throw new Error(
      `Postgres is not reachable at ${redactDatabaseUrl(connectionString)}. Start local Postgres or set DATABASE_URL.`,
      { cause: initial.error },
    );
  }

  const errorCode = (initial.error as { code?: unknown })?.code;
  if (errorCode === '3D000' && (await commandAvailable('createdb'))) {
    const url = new URL(connectionString);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!databaseName) throw new Error('DATABASE_URL must include a database name.');
    const args = [
      '-h',
      url.hostname,
      '-p',
      url.port || '5432',
      ...(url.username ? ['-U', decodeURIComponent(url.username)] : []),
      databaseName,
    ];
    const createdbEnv = {
      ...environment,
      ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
    };
    try {
      await runCommand('createdb', args, { environment: createdbEnv });
      const after = await connectablePostgres(connectionString);
      if (after.ok) return connectionString;
    } catch {
      // The default URL is only a convenience. If local Postgres cannot create
      // it, continue to the PGlite fallback below.
    }
  }

  return ensurePGliteDatabase(environment);
}

function pglitePort(environment: NodeJS.ProcessEnv): number {
  const port = Number.parseInt(
    environment.PGLITE_PORT?.trim() || String(PGLITE_DEFAULT_PORT),
    10,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PGLITE_PORT must be between 1 and 65535 (received ${port})`);
  }
  return port;
}

function pgliteUrl(host: string, port: number): string {
  return `postgresql://postgres:postgres@${host}:${port}/${PGLITE_DATABASE}`;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function clearPGliteState(): Promise<void> {
  await unlink(PGLITE_STATE_PATH).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}

async function readPGliteState(): Promise<PGliteState | null> {
  let contents: string;
  try {
    contents = await readFile(PGLITE_STATE_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(contents) as Partial<PGliteState>;
    if (
      parsed.kind !== 'agent-server-pglite' ||
      !Number.isInteger(parsed.pid) ||
      typeof parsed.host !== 'string' ||
      !Number.isInteger(parsed.port) ||
      typeof parsed.database !== 'string' ||
      typeof parsed.url !== 'string' ||
      typeof parsed.dataPath !== 'string'
    ) {
      throw new Error('invalid shape');
    }
    return parsed as PGliteState;
  } catch (error) {
    await clearPGliteState();
    throw new Error(
      `Ignoring malformed PGlite state at ${PGLITE_STATE_PATH}; rerun setup.`,
      { cause: error },
    );
  }
}

export async function identifyDatabaseBackend(
  connectionString: string,
): Promise<HostDatabaseBackend> {
  const state = await readPGliteState();
  return state && state.url === connectionString && processIsAlive(state.pid)
    ? 'pglite'
    : 'postgres';
}

async function waitForPGlite(
  child: ChildProcess,
  fallbackUrl: string,
): Promise<string> {
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (exited) {
      throw new Error(
        `PGlite fallback exited before becoming ready (${exited.code ?? exited.signal ?? 'unknown'}). Check ${resolve(repositoryRoot, '.local/dev-runtime/pglite.log')}.`,
      );
    }
    const state = await readPGliteState();
    if (state && state.pid === child.pid && (await connectablePostgres(state.url)).ok) {
      return state.url;
    }
    if ((await connectablePostgres(fallbackUrl)).ok) return fallbackUrl;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(
    `Timed out starting PGlite at ${fallbackUrl}. Check ${resolve(repositoryRoot, '.local/dev-runtime/pglite.log')}.`,
  );
}

async function ensurePGliteDatabase(
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  await ensureLocalDirectories();
  const port = pglitePort(environment);
  const fallbackUrl = pgliteUrl(PGLITE_HOST, port);
  const existing = await readPGliteState();
  if (existing) {
    if (!processIsAlive(existing.pid)) {
      await clearPGliteState();
    } else if ((await connectablePostgres(existing.url)).ok) {
      return existing.url;
    } else {
      throw new Error(
        `PGlite state claims live process ${existing.pid}, but ${existing.url} is unreachable. Stop that process or remove ${PGLITE_STATE_PATH} after verifying it is stale.`,
      );
    }
  }
  if (!(await isPortFree(port))) {
    throw new Error(
      `PGlite fallback port ${PGLITE_HOST}:${port} is already in use. Set PGLITE_PORT to a free port; the harness will not take over an unknown process.`,
    );
  }

  const logPath = resolve(repositoryRoot, '.local/dev-runtime/pglite.log');
  const logFd = openSync(logPath, 'a', 0o600);
  let child: ChildProcess;
  try {
    child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve(repositoryRoot, 'tooling/dev/pglite-server.ts')],
      {
        cwd: repositoryRoot,
        detached: true,
        env: {
          ...environment,
          PGLITE_HOST,
          PGLITE_PORT: String(port),
          PGLITE_DATABASE,
          PGLITE_DATA_PATH,
          PGLITE_STATE_PATH,
        },
        stdio: ['ignore', logFd, logFd],
      },
    );
  } finally {
    closeSync(logFd);
  }
  child.unref();
  return waitForPGlite(child, fallbackUrl);
}

export async function prepareHostNativeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const loaded = await loadLocalDotEnv(environment);
  await ensureLocalDirectories();
  const connectionString = await ensureDevelopmentDatabase(loaded);
  const pool = new Pool({ connectionString, max: 2 });
  try {
    await applyDurableKernelMigrations(pool);
  } finally {
    await pool.end();
  }
  return {
    ...loaded,
    DATABASE_URL: connectionString,
    POSTGRES_URL: connectionString,
    POSTGRES_ADMIN_URL: connectionString,
  };
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolveFree) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolveFree(false));
    server.listen(port, '127.0.0.1', () =>
      server.close(() => resolveFree(true)),
    );
  });
}

export async function canConnectTcp(
  host: string,
  port: number,
  timeoutMs = 500,
): Promise<boolean> {
  return new Promise<boolean>((resolveConnected) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolveConnected(false);
    }, timeoutMs);
    timer.unref?.();
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolveConnected(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolveConnected(false);
    });
  });
}

export async function waitForHttp(
  url: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for ${url}`, { cause: lastError });
}

export async function readable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function spawnOwned(
  command: string,
  args: readonly string[],
  options: {
    readonly environment: NodeJS.ProcessEnv;
    readonly cwd?: string;
  },
): ChildProcess {
  return spawn(command, [...args], {
    cwd: options.cwd ?? repositoryRoot,
    env: options.environment,
    stdio: 'inherit',
  });
}

export async function stopOwned(children: readonly ChildProcess[]): Promise<void> {
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolveStop) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolveStop();
            return;
          }
          const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            resolveStop();
          }, 3_000);
          timeout.unref?.();
          child.once('exit', () => {
            clearTimeout(timeout);
            resolveStop();
          });
          child.kill('SIGTERM');
        }),
    ),
  );
}

export function redactDatabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
}
