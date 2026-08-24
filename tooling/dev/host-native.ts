import { spawn, type ChildProcess } from 'node:child_process';
import {
  access,
  mkdir,
  open as openFile,
  readFile,
  unlink,
} from 'node:fs/promises';
import { chmodSync, closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection, createServer } from 'node:net';
import { Writable, type WritableOptions } from 'node:stream';

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
const HOST_RUNTIME_LOG_DIRECTORY = resolve(
  repositoryRoot,
  '.local/dev-runtime/logs',
);
const MAX_LOG_TAIL_LINES = 80;
const MAX_LOG_TAIL_CHARACTERS = 16_384;
const MAX_LOG_TAIL_BYTES = 64 * 1024;

type ChildLifecycle = Readonly<{
  readonly promise: Promise<ChildLifecycleOutcome>;
  readonly getOutcome: () => ChildLifecycleOutcome | undefined;
}>;

type ChildLifecycleOutcome =
  | Readonly<{ kind: 'error'; error: Error }>
  | Readonly<{
      kind: 'exit';
      code: number | null;
      signal: NodeJS.Signals | null;
    }>;

const childLifecycles = new WeakMap<ChildProcess, ChildLifecycle>();
const childLogPaths = new WeakMap<ChildProcess, string>();
const childLogFlushes = new WeakMap<ChildProcess, () => Promise<void>>();
let runtimeLogSequence = 0;

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

async function seedLocalWorkspaces(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO workspaces
       (id, tenant_id, principal_type, principal_id, name, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, now(), now()),
       ($6, $7, $8, $9, $10, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [
      LOCAL_WORKSPACE_ID,
      'tenant_local',
      'service_account',
      'svc_local',
      'Local development workspace',
      '00000000-0000-4000-8000-000000000002',
      'tenant_local_2',
      'service_account',
      'svc_local_2',
      'Local development workspace 2',
    ],
  );
}

export async function loadLocalDotEnv(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const result = { ...environment };
  for (const fileName of ['.env', '.env.local', '.local/model.env']) {
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

export function hostWebEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
    readonly abortOn?: {
      readonly child: ChildProcess;
      readonly environment: NodeJS.ProcessEnv;
      readonly label: string;
      readonly healthUrl?: string;
      readonly healthFailureLimit?: number;
    };
  } = {},
): Promise<void> {
  const environment = options.environment ?? process.env;
  const isolateCommandTree =
    Boolean(options.abortOn) && process.platform !== 'win32';
  await new Promise<void>((resolveRun, reject) => {
    let settled = false;
    let healthTimer: NodeJS.Timeout | undefined;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (healthTimer) clearInterval(healthTimer);
      if (error) reject(error);
      else resolveRun();
    };
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? repositoryRoot,
      env: environment,
      stdio: options.stdio ?? 'inherit',
      detached: isolateCommandTree,
    });
    child.once('error', (error) => settle(error));
    child.once('exit', (code, signal) => {
      if (code === 0) settle();
      else
        settle(new Error(`${command} exited ${code ?? signal ?? 'unknown'}`));
    });
    const abortOn = options.abortOn;
    if (!abortOn) return;
    const lifecycle = childLifecycles.get(abortOn.child);
    if (!lifecycle) {
      terminateCommandTree(child);
      settle(
        new Error(
          `${abortOn.label} lifecycle is not tracked; ${command} was not started safely.`,
        ),
      );
      return;
    }
    const failFromPrimary = (reason: string) => {
      if (settled) return;
      terminateCommandTree(child);
      void childDiagnostic(
        abortOn.child,
        abortOn.label,
        abortOn.environment,
      ).then(
        (diagnostic) => {
          settle(new Error(`${reason}\n${diagnostic}`));
        },
        (error) => {
          settle(error instanceof Error ? error : new Error(String(error)));
        },
      );
    };
    if (lifecycle.getOutcome()) {
      failFromPrimary(
        `canary primary child exited while ${command} was running`,
      );
      return;
    }
    void lifecycle.promise.then(() => {
      failFromPrimary(
        `canary primary child exited while ${command} was running`,
      );
    });
    const healthUrl = abortOn.healthUrl?.trim();
    if (!healthUrl) return;
    const healthFailureLimit = Math.max(1, abortOn.healthFailureLimit ?? 5);
    let consecutiveHealthFailures = 0;
    healthTimer = setInterval(() => {
      void (async () => {
        if (settled) return;
        try {
          const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(1_000),
          });
          consecutiveHealthFailures = response.ok
            ? 0
            : consecutiveHealthFailures + 1;
        } catch {
          consecutiveHealthFailures += 1;
        }
        if (consecutiveHealthFailures >= healthFailureLimit) {
          failFromPrimary(
            `canary primary child failed health while ${command} was running`,
          );
        }
      })();
    }, 1_000);
  });
}

function signalOwnedTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (!pid || process.platform === 'win32') {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      child.kill(signal);
    }
  }
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once('exit', onExit);
  });
}

function terminateCommandTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalOwnedTree(child, 'SIGTERM');
  const killer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    signalOwnedTree(child, 'SIGKILL');
  }, 2_000);
  void killer;
}

export async function connectablePostgres(
  connectionString: string,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1_500,
  });
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
    if (!databaseName)
      throw new Error('DATABASE_URL must include a database name.');
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
    throw new Error(
      `PGLITE_PORT must be between 1 and 65535 (received ${port})`,
    );
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
  let exited:
    { code: number | null; signal: NodeJS.Signals | null } | undefined;
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
    if (
      state &&
      state.pid === child.pid &&
      (await connectablePostgres(state.url)).ok
    ) {
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
      [
        '--import',
        'tsx',
        resolve(repositoryRoot, 'tooling/dev/pglite-server.ts'),
      ],
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
    await seedLocalWorkspaces(pool);
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

function runtimeLogName(value: string): string {
  const name = value.trim().replace(/\.log$/u, '');
  if (!name || !/^[A-Za-z0-9._-]+$/u.test(name)) {
    throw new Error(`invalid host runtime log name: ${value}`);
  }
  return name;
}

function createRuntimeLogFile(name: string): { fd: number; path: string } {
  mkdirSync(HOST_RUNTIME_LOG_DIRECTORY, { recursive: true, mode: 0o700 });
  chmodSync(HOST_RUNTIME_LOG_DIRECTORY, 0o700);
  const safeName = runtimeLogName(name);
  for (;;) {
    runtimeLogSequence += 1;
    const path = resolve(
      HOST_RUNTIME_LOG_DIRECTORY,
      `${safeName}-${Date.now()}-${process.pid}-${runtimeLogSequence}.log`,
    );
    try {
      return { fd: openSync(path, 'wx', 0o600), path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

function redactRuntimeLog(
  content: string,
  environment: NodeJS.ProcessEnv,
): string {
  return redactRuntimeValues(content, runtimeSecretValues(environment));
}

function runtimeSecretValues(environment: NodeJS.ProcessEnv): string[] {
  return Object.entries(environment)
    .filter(
      ([name, value]) =>
        /(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|DATABASE_URL|POSTGRES_URL|SERVICE_ACCOUNTS_JSON|OPENCODE_CONFIG_CONTENT)/iu.test(
          name,
        ) && Boolean(value?.trim()),
    )
    .map(([, value]) => value!.trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => right.length - left.length);
}

function redactRuntimeValues(
  content: string,
  values: readonly string[],
): string {
  return values.reduce(
    (result, value) => result.replaceAll(value, '[redacted]'),
    content,
  );
}

class RuntimeLogRedactor extends Writable {
  private pending = '';

  constructor(
    private readonly destination: NodeJS.WritableStream,
    private readonly secretValues: readonly string[],
    options?: WritableOptions,
  ) {
    super({ ...options, decodeStrings: false });
  }

  override _write(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const newline = this.pending.lastIndexOf('\n');
    if (newline < 0) {
      callback();
      return;
    }
    const processable = this.pending.slice(0, newline + 1);
    this.pending = this.pending.slice(newline + 1);
    if (!processable) {
      callback();
      return;
    }
    this.destination.write(
      redactRuntimeValues(processable, this.secretValues),
      callback,
    );
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (!this.pending) {
      callback();
      return;
    }
    this.destination.write(
      redactRuntimeValues(this.pending, this.secretValues),
      callback,
    );
  }
}

function attachRuntimeLogSinks(
  child: ChildProcess,
  log: { fd: number },
  environment: NodeJS.ProcessEnv,
): () => Promise<void> {
  if (!child.stdout || !child.stderr) {
    throw new Error('host runtime file logging requires piped child output');
  }
  const destination = createWriteStream(undefined as never, {
    fd: log.fd,
    autoClose: false,
  });
  const secretValues = runtimeSecretValues(environment);
  const redactors = [child.stdout, child.stderr].map((source) => {
    source.setEncoding('utf8');
    const redactor = new RuntimeLogRedactor(destination, secretValues);
    source.pipe(redactor);
    return redactor;
  });
  let remaining = redactors.length;
  let flushed = false;
  let resolveFlushed: () => void = () => undefined;
  const flushedPromise = new Promise<void>((resolveFlush) => {
    resolveFlushed = resolveFlush;
  });
  const markFlushed = () => {
    if (flushed) return;
    flushed = true;
    resolveFlushed();
  };
  const closeLog = () => {
    remaining -= 1;
    if (remaining === 0) {
      destination.end(() => {
        closeSync(log.fd);
        markFlushed();
      });
    }
  };
  for (const redactor of redactors) redactor.once('finish', closeLog);
  return () => {
    if (!flushed) {
      for (const redactor of redactors) {
        if (!redactor.writableEnded) redactor.end();
      }
    }
    return Promise.race([
      flushedPromise,
      new Promise<void>((resolveTimeout) => {
        setTimeout(resolveTimeout, 2_000);
      }),
    ]);
  };
}

export async function readRuntimeLogTail(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const resolvedPath = resolve(path);
  const logRoot = `${HOST_RUNTIME_LOG_DIRECTORY}${resolve('/')}`;
  if (!resolvedPath.startsWith(logRoot)) {
    throw new Error('runtime log path must be under .local/dev-runtime/logs');
  }
  let content: string;
  try {
    const file = await openFile(resolvedPath, 'r');
    try {
      const { size } = await file.stat();
      const length = Math.min(size, MAX_LOG_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, Math.max(0, size - length));
      content = buffer.toString('utf8');
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '[runtime log is unavailable]';
    }
    throw error;
  }
  const bounded = redactRuntimeLog(content, environment).slice(
    -MAX_LOG_TAIL_CHARACTERS,
  );
  const lines = bounded.split(/\r?\n/u);
  return (
    lines.slice(-MAX_LOG_TAIL_LINES).join('\n') || '[runtime log is empty]'
  );
}

export function ownedChildLogPath(child: ChildProcess): string | undefined {
  return childLogPaths.get(child);
}

function trackChildLifecycle(child: ChildProcess): void {
  let outcome: ChildLifecycleOutcome | undefined;
  let resolveLifecycle: (value: ChildLifecycleOutcome) => void = () =>
    undefined;
  const promise = new Promise<ChildLifecycleOutcome>(
    (resolveLifecycleValue) => {
      resolveLifecycle = resolveLifecycleValue;
    },
  );
  const settle = (next: ChildLifecycleOutcome) => {
    if (outcome) return;
    outcome = next;
    resolveLifecycle(next);
  };
  child.once('error', (error) => {
    settle({
      kind: 'error',
      error: error instanceof Error ? error : new Error(String(error)),
    });
  });
  child.once('exit', (code, signal) => {
    settle({ kind: 'exit', code, signal });
  });
  child.once('close', (code, signal) => {
    settle({ kind: 'exit', code, signal });
  });
  childLifecycles.set(child, {
    promise,
    getOutcome: () => outcome,
  });
}

async function childDiagnostic(
  child: ChildProcess,
  label: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const lifecycle = childLifecycles.get(child);
  const outcome = lifecycle?.getOutcome();
  const state = outcome
    ? outcome.kind === 'error'
      ? `error=${redactRuntimeLog(outcome.error.message, environment)}`
      : `exitCode=${outcome.code ?? 'null'} signal=${outcome.signal ?? 'none'}`
    : `exitCode=${child.exitCode ?? 'null'} signal=${child.signalCode ?? 'none'}`;
  const logPath = ownedChildLogPath(child);
  const tail = logPath
    ? await readRuntimeLogTail(logPath, environment)
    : '[no runtime log was configured]';
  return `${label}: ${state}; log=${logPath ?? 'none'}\nlog tail:\n${tail}`;
}

export async function waitForHttp(
  url: string,
  timeoutMs = 30_000,
  options: {
    readonly child?: ChildProcess;
    readonly environment?: NodeJS.ProcessEnv;
    readonly label?: string;
  } = {},
): Promise<void> {
  const child = options.child;
  const lifecycle = child ? childLifecycles.get(child) : undefined;
  const environment = options.environment ?? process.env;
  const label = options.label ?? 'host child';
  const readinessAbort = new AbortController();
  let diagnosticAttached = false;
  const waitForReadiness = (async () => {
    const startedAt = Date.now();
    let lastError: unknown;
    while (
      !readinessAbort.signal.aborted &&
      Date.now() - startedAt < timeoutMs
    ) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([
            readinessAbort.signal,
            AbortSignal.timeout(1_000),
          ]),
        });
        if (response.ok) {
          const childStopped = Boolean(
            lifecycle?.getOutcome() ||
            (child && (child.exitCode !== null || child.signalCode !== null)),
          );
          if (childStopped) {
            diagnosticAttached = true;
            throw new Error(await childDiagnostic(child!, label, environment));
          }
          return { kind: 'ready' as const };
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise<void>((resolveDelay) => {
        let timer: NodeJS.Timeout;
        const complete = () => {
          clearTimeout(timer);
          readinessAbort.signal.removeEventListener('abort', abort);
          resolveDelay();
        };
        const abort = () => {
          complete();
        };
        timer = setTimeout(complete, 200);
        readinessAbort.signal.addEventListener('abort', abort, { once: true });
        if (readinessAbort.signal.aborted) abort();
      });
    }
    if (readinessAbort.signal.aborted) return { kind: 'cancelled' as const };
    throw new Error(`Timed out waiting for ${url}`, { cause: lastError });
  })();
  try {
    const result = lifecycle
      ? await Promise.race([
          waitForReadiness,
          lifecycle.promise.then((outcome) => ({
            kind: 'child' as const,
            outcome,
          })),
        ])
      : await waitForReadiness;
    if (result.kind === 'child') {
      diagnosticAttached = true;
      throw new Error(await childDiagnostic(child!, label, environment));
    }
  } catch (error) {
    if (child && !diagnosticAttached) {
      const diagnostic = await childDiagnostic(child, label, environment);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${diagnostic}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    readinessAbort.abort();
    await waitForReadiness.catch(() => undefined);
  }
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
    readonly logName?: string;
  },
): ChildProcess {
  const log = options.logName
    ? createRuntimeLogFile(options.logName)
    : undefined;
  try {
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? repositoryRoot,
      env: options.environment,
      stdio: log ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      detached: process.platform !== 'win32',
    });
    if (log) {
      childLogPaths.set(child, log.path);
      childLogFlushes.set(
        child,
        attachRuntimeLogSinks(child, log, options.environment),
      );
    }
    trackChildLifecycle(child);
    return child;
  } catch (error) {
    if (log) closeSync(log.fd);
    throw error;
  }
}

export async function stopOwned(
  children: readonly ChildProcess[],
): Promise<void> {
  const leftovers: string[] = [];
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      signalOwnedTree(child, 'SIGTERM');
      // Allow with-paseo's 8s SIGTERM and 2s SIGKILL cleanup to finish.
      const stopped = await waitForChildExit(child, 11_000);
      if (!stopped) {
        signalOwnedTree(child, 'SIGKILL');
        const killed = await waitForChildExit(child, 2_000);
        if (!killed) {
          leftovers.push(`pid=${child.pid ?? 'unknown'}`);
        }
      }
    }
    const flush = childLogFlushes.get(child);
    if (flush) await flush();
  }
  if (leftovers.length > 0) {
    throw new Error(`owned child did not exit: ${leftovers.join(', ')}`);
  }
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
