import { access, constants } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { Pool } from 'pg';

import { durableKernelMigrationFileNames } from '../../src/infrastructure/postgres/postgres.js';
import {
  canConnectTcp,
  commandAvailable,
  defaultHostDatabaseUrl,
  ensureDevelopmentDatabase,
  identifyDatabaseBackend,
  isPortFree,
  loadLocalDotEnv,
  redactDatabaseUrl,
} from './host-native.js';
import {
  providerToolchainPaths,
  repositoryRoot,
  validateProviders,
} from './setup-providers.js';
import type { HostDatabaseBackend } from './host-native.js';

export type DoctorCheck = Readonly<{
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  requiredFor: readonly ('core' | 'scenario' | 'runtime')[];
}>;

type PostgresChecks = Readonly<{
  checks: readonly [DoctorCheck, DoctorCheck];
  backend: HostDatabaseBackend;
}>;

function databaseDetail(
  connectionString: string,
  backend: HostDatabaseBackend,
): string {
  if (backend === 'pglite') {
    try {
      const parsed = new URL(connectionString);
      return `PGlite wire server at ${parsed.host} — development usable; real PG semantics not covered`;
    } catch {
      return 'PGlite wire server — development usable; real PG semantics not covered';
    }
  }
  return `real PostgreSQL at ${redactDatabaseUrl(connectionString)}`;
}

async function postgresChecks(
  environment: NodeJS.ProcessEnv,
): Promise<PostgresChecks> {
  let connectionString: string;
  try {
    connectionString = await ensureDevelopmentDatabase(environment);
  } catch (error) {
    connectionString = defaultHostDatabaseUrl(environment);
    const postgres: DoctorCheck = {
      name: 'postgres',
      status: 'fail',
      detail: `real PostgreSQL at ${redactDatabaseUrl(connectionString)} (${error instanceof Error ? error.message : 'unreachable'})`,
      requiredFor: ['core', 'runtime'],
    };
    return {
      backend: 'postgres',
      checks: [
        postgres,
        {
          name: 'migrations',
          status: 'fail',
          detail: 'not checked because PostgreSQL is unreachable',
          requiredFor: ['core', 'runtime'],
        },
      ],
    };
  }
  const backend = await identifyDatabaseBackend(connectionString, environment);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1_500,
  });
  try {
    await pool.query('SELECT 1');
    const postgres: DoctorCheck = {
      name: 'postgres',
      status: 'ok',
      detail: databaseDetail(connectionString, backend),
      requiredFor: ['core', 'runtime'],
    };
    try {
      const result = await pool.query<{ version: string }>(
        'SELECT version FROM durable_kernel_schema_migrations',
      );
      const applied = new Set(result.rows.map((row) => row.version));
      const expected = durableKernelMigrationFileNames.map((fileName) =>
        fileName.replace(/\.sql$/, ''),
      );
      const missing = expected.filter((version) => !applied.has(version));
      return {
        backend,
        checks: [
          postgres,
          {
            name: 'migrations',
            status: missing.length === 0 ? 'ok' : 'fail',
            detail:
              missing.length === 0
                ? `${expected.length}/${expected.length} durable migrations applied`
                : `${applied.size}/${expected.length} applied; run pnpm run setup (missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''})`,
            requiredFor: ['core', 'runtime'],
          },
        ],
      };
    } catch (error) {
      return {
        backend,
        checks: [
          postgres,
          {
            name: 'migrations',
            status: 'fail',
            detail: `migration registry unavailable; run pnpm run setup (${error instanceof Error ? error.message : 'unknown error'})`,
            requiredFor: ['core', 'runtime'],
          },
        ],
      };
    }
  } catch (error) {
    const postgres: DoctorCheck = {
      name: 'postgres',
      status: 'fail',
      detail: `${databaseDetail(connectionString, backend)} (${error instanceof Error ? error.message : 'unreachable'})`,
      requiredFor: ['core', 'runtime'],
    };
    return {
      backend,
      checks: [
        postgres,
        {
          name: 'migrations',
          status: 'fail',
          detail: 'not checked because PostgreSQL is unreachable',
          requiredFor: ['core', 'runtime'],
        },
      ],
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function paseoCheck(
  environment: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const configuredWsUrl = environment.PASEO_WS_URL?.trim();
  if (!configuredWsUrl) {
    try {
      await validateProviders(environment);
      return {
        name: 'paseo',
        status: 'ok',
        detail: 'provisioned provider-toolchain Paseo binary is valid',
        requiredFor: ['runtime'],
      };
    } catch (error) {
      return {
        name: 'paseo',
        status: 'warn',
        detail: `provider-toolchain Paseo binary unavailable: ${error instanceof Error ? error.message : String(error)}`,
        requiredFor: ['runtime'],
      };
    }
  }
  const wsUrl = configuredWsUrl;
  try {
    const parsed = new URL(wsUrl);
    const port = Number.parseInt(
      parsed.port || (parsed.protocol === 'wss:' ? '443' : '80'),
      10,
    );
    const reachable = await canConnectTcp(parsed.hostname, port);
    return {
      name: 'paseo',
      status: reachable ? 'ok' : 'warn',
      detail: reachable
        ? `reachable at ${parsed.hostname}:${port}`
        : `not running at ${parsed.hostname}:${port}; pnpm dev still works`,
      requiredFor: ['runtime'],
    };
  } catch {
    return {
      name: 'paseo',
      status: 'warn',
      detail: `invalid PASEO_WS_URL: ${wsUrl}`,
      requiredFor: ['runtime'],
    };
  }
}

type ProviderBinaryName = 'paseo' | 'opencode' | 'claude' | 'codex';

const providerBinaryNames: readonly ProviderBinaryName[] = [
  'paseo',
  'opencode',
  'claude',
  'codex',
];

async function binaryVersion(path: string): Promise<string> {
  return new Promise((resolveVersion) => {
    const child = spawn(path, ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolveVersion('unavailable');
    }, 15_000);
    timer.unref?.();
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolveVersion('unavailable');
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolveVersion('unavailable');
        return;
      }
      resolveVersion(
        output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/u)?.[0] ??
          'unknown',
      );
    });
  });
}

async function providerBinaryStatus(): Promise<string> {
  const statuses = await Promise.all(
    providerBinaryNames.map(async (name) => {
      try {
        await access(providerToolchainPaths[name], constants.X_OK);
      } catch {
        return `${name}=absent`;
      }
      return `${name}=installed(${await binaryVersion(providerToolchainPaths[name])})`;
    }),
  );
  return statuses.join(',');
}

async function providerConfigStatus(): Promise<string> {
  const configPaths = {
    claude: join(
      repositoryRoot,
      '.local/dev-runtime/home/.claude/settings.json',
    ),
    codex: join(repositoryRoot, '.local/dev-runtime/home/.codex/config.toml'),
  } as const;
  const statuses = await Promise.all(
    Object.entries(configPaths).map(async ([name, path]) => {
      try {
        await access(path, constants.R_OK);
        return `${name}=present`;
      } catch {
        return `${name}=absent`;
      }
    }),
  );
  return `${statuses.join(',')},opencode=runtime-env`;
}

async function providerCheck(
  environment: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const provider = (
    environment.PASEO_PROVIDER?.trim() || 'claude'
  ).toLowerCase();
  const keyByProvider: Readonly<Record<string, string>> = {
    opencode: 'OPENCODE_GO_API_KEY',
    claude: 'OPENCODE_GO_API_KEY',
    anthropic: 'OPENCODE_GO_API_KEY',
    codex: 'OPENAI_API_KEY',
    openai: 'OPENAI_API_KEY',
  };
  const keyName = keyByProvider[provider];
  if (!keyName) {
    return {
      name: 'provider',
      status: 'warn',
      detail: `${provider}: no canonical credential probe; core development is unaffected`,
      requiredFor: ['runtime'],
    };
  }
  const [binaryStatus, configStatus] = await Promise.all([
    providerBinaryStatus(),
    providerConfigStatus(),
  ]);
  let validationStatus = 'failed';
  let validationError = '';
  try {
    await validateProviders(environment);
    validationStatus = 'valid';
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }
  const configured = Boolean(environment[keyName]?.trim());
  const binariesInstalled = providerBinaryNames.every((name) =>
    binaryStatus.includes(`${name}=installed(`),
  );
  const ready = configured && binariesInstalled && validationStatus === 'valid';
  return {
    name: 'provider',
    status: ready ? 'ok' : 'warn',
    detail: `${provider}: ${keyName}=${configured ? 'configured' : 'absent'}; validation=${validationStatus}${validationError ? `(${validationError})` : ''}; ${binaryStatus}; config=${configStatus}`,
    requiredFor: ['runtime'],
  };
}

export async function runDoctor(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<readonly DoctorCheck[]> {
  const loaded = await loadLocalDotEnv(environment);
  const nodeMajor = Number.parseInt(
    process.versions.node.split('.')[0] ?? '0',
    10,
  );
  const [
    pnpmAvailable,
    psqlAvailable,
    apiPortFree,
    webPortFree,
    postgresPairResult,
    paseo,
  ] = await Promise.all([
    commandAvailable('pnpm'),
    commandAvailable('psql'),
    isPortFree(Number(loaded.PORT ?? 3000)),
    isPortFree(3001),
    postgresChecks(loaded),
    paseoCheck(loaded),
  ]);
  const { checks: postgresPair, backend } = postgresPairResult;
  const [postgres, migrations] = postgresPair;
  const checks: DoctorCheck[] = [
    {
      name: 'node',
      status: nodeMajor >= 22 && nodeMajor < 25 ? 'ok' : 'fail',
      detail: process.version,
      requiredFor: ['core', 'scenario', 'runtime'],
    },
    {
      name: 'pnpm',
      status: pnpmAvailable ? 'ok' : 'fail',
      detail: pnpmAvailable ? 'available' : 'not found',
      requiredFor: ['core', 'scenario', 'runtime'],
    },
    {
      name: 'psql',
      status: psqlAvailable ? 'ok' : 'warn',
      detail: psqlAvailable
        ? 'available'
        : 'not found; the Node pg driver can still connect to an existing database',
      requiredFor: ['core'],
    },
    postgres,
    migrations,
    {
      name: 'api-port',
      // Why this exists: doctor must predict whether pnpm dev can bind its API.
      // Design contract: an occupied required port is a failure, not a warning.
      // Design goals: make readiness actionable before starting child processes.
      status: apiPortFree ? 'ok' : 'fail',
      detail: apiPortFree
        ? `:${loaded.PORT ?? 3000} free`
        : `:${loaded.PORT ?? 3000} already in use`,
      requiredFor: ['core', 'runtime'],
    },
    {
      name: 'web-port',
      // Why this exists: core startup also owns the Web port.
      // Design contract: an occupied required port makes core readiness false.
      // Design goals: keep doctor metadata consistent with actual startup.
      status: webPortFree ? 'ok' : 'fail',
      detail: webPortFree ? ':3001 free' : ':3001 already in use',
      requiredFor: ['core', 'runtime'],
    },
    paseo,
    await providerCheck(loaded),
  ];

  const coreReady = !checks.some(
    (check) => check.status === 'fail' && check.requiredFor.includes('core'),
  );
  const scenarioReady = !checks.some(
    (check) =>
      check.status === 'fail' && check.requiredFor.includes('scenario'),
  );
  const runtimeReady =
    coreReady &&
    checks.find((check) => check.name === 'paseo')?.status === 'ok' &&
    checks.find((check) => check.name === 'provider')?.status === 'ok';
  /*
   * Why this exists: PGlite speaks the PostgreSQL wire protocol but cannot
   * prove PostgreSQL-specific semantics. The backend gate prevents a PGlite
   * fallback from becoming a false-green real-Postgres signal.
   * Design contract: ready.pg is true only for reachable, migrated real
   * PostgreSQL; PGlite may still make ready.core true.
   * Design goals: keep capability reporting honest and independently useful.
   */
  const pgReady =
    backend === 'postgres' &&
    postgres.status === 'ok' &&
    migrations.status === 'ok';

  for (const check of checks) {
    const icon =
      check.status === 'ok' ? '✓' : check.status === 'warn' ? '○' : '✗';
    process.stdout.write(`${icon} ${check.name}: ${check.detail}\n`);
  }
  process.stdout.write(`\nready.core=${coreReady}\n`);
  process.stdout.write(`ready.pg=${pgReady}\n`);
  process.stdout.write(`ready.scenario=${scenarioReady}\n`);
  process.stdout.write(`ready.runtime=${runtimeReady}\n`);
  process.stdout.write(
    `${JSON.stringify({ event: 'agent_server_doctor', backend, ready: { pg: pgReady, core: coreReady, scenario: scenarioReady, runtime: runtimeReady }, coreReady, pgReady, scenarioReady, runtimeReady, checks })}\n`,
  );

  if (!coreReady || !scenarioReady) process.exitCode = 1;
  return checks;
}

runDoctor().catch((error: unknown) => {
  process.stderr.write(
    `doctor failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
