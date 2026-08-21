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
  const backend = await identifyDatabaseBackend(connectionString);
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
                : `${applied.size}/${expected.length} applied; run pnpm setup (missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''})`,
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
            detail: `migration registry unavailable; run pnpm setup (${error instanceof Error ? error.message : 'unknown error'})`,
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
  const wsUrl = environment.PASEO_WS_URL?.trim() || 'ws://127.0.0.1:6767/ws';
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

function providerCheck(environment: NodeJS.ProcessEnv): DoctorCheck {
  const provider = (environment.PASEO_PROVIDER?.trim() || 'opencode').toLowerCase();
  const keyByProvider: Readonly<Record<string, string>> = {
    opencode: 'OPENCODE_GO_API_KEY',
    claude: 'ANTHROPIC_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
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
  const configured = Boolean(environment[keyName]?.trim());
  return {
    name: 'provider',
    status: configured ? 'ok' : 'warn',
    detail: configured
      ? `${provider}: ${keyName} is configured`
      : `${provider}: ${keyName} is not exported; pnpm dev still works`,
    requiredFor: ['runtime'],
  };
}

export async function runDoctor(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<readonly DoctorCheck[]> {
  const loaded = await loadLocalDotEnv(environment);
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const [pnpmAvailable, psqlAvailable, apiPortFree, webPortFree, postgresPairResult, paseo] =
    await Promise.all([
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
    providerCheck(loaded),
  ];

  const coreReady = !checks.some(
    (check) => check.status === 'fail' && check.requiredFor.includes('core'),
  );
  const scenarioReady = !checks.some(
    (check) => check.status === 'fail' && check.requiredFor.includes('scenario'),
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
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '○' : '✗';
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
