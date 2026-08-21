import { Pool } from 'pg';

import {
  canConnectTcp,
  commandAvailable,
  defaultHostDatabaseUrl,
  isPortFree,
  loadLocalDotEnv,
  redactDatabaseUrl,
} from './host-native.js';

export type DoctorCheck = Readonly<{
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  requiredFor: readonly ('core' | 'scenario' | 'runtime')[];
}>;

async function postgresCheck(
  environment: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const connectionString = defaultHostDatabaseUrl(environment);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1_500,
  });
  try {
    await pool.query('SELECT 1');
    return {
      name: 'postgres',
      status: 'ok',
      detail: redactDatabaseUrl(connectionString),
      requiredFor: ['core', 'runtime'],
    };
  } catch (error) {
    return {
      name: 'postgres',
      status: 'fail',
      detail: `${redactDatabaseUrl(connectionString)} (${error instanceof Error ? error.message : 'unreachable'})`,
      requiredFor: ['core', 'runtime'],
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

export async function runDoctor(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<readonly DoctorCheck[]> {
  const loaded = await loadLocalDotEnv(environment);
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const checks: DoctorCheck[] = [
    {
      name: 'node',
      status: nodeMajor >= 22 && nodeMajor < 25 ? 'ok' : 'fail',
      detail: process.version,
      requiredFor: ['core', 'scenario', 'runtime'],
    },
    {
      name: 'pnpm',
      status: (await commandAvailable('pnpm')) ? 'ok' : 'fail',
      detail: (await commandAvailable('pnpm')) ? 'available' : 'not found',
      requiredFor: ['core', 'scenario', 'runtime'],
    },
    {
      name: 'psql',
      status: (await commandAvailable('psql')) ? 'ok' : 'warn',
      detail: (await commandAvailable('psql'))
        ? 'available'
        : 'not found; the Node pg driver can still connect to an existing database',
      requiredFor: ['core'],
    },
    await postgresCheck(loaded),
    {
      name: 'api-port',
      status: (await isPortFree(Number(loaded.PORT ?? 3000))) ? 'ok' : 'warn',
      detail: (await isPortFree(Number(loaded.PORT ?? 3000)))
        ? `:${loaded.PORT ?? 3000} free`
        : `:${loaded.PORT ?? 3000} already in use`,
      requiredFor: ['core', 'runtime'],
    },
    {
      name: 'web-port',
      status: (await isPortFree(3001)) ? 'ok' : 'warn',
      detail: (await isPortFree(3001)) ? ':3001 free' : ':3001 already in use',
      requiredFor: ['core', 'runtime'],
    },
    await paseoCheck(loaded),
  ];

  const coreReady = !checks.some(
    (check) => check.status === 'fail' && check.requiredFor.includes('core'),
  );
  const scenarioReady = !checks.some(
    (check) => check.status === 'fail' && check.requiredFor.includes('scenario'),
  );
  const runtimeReady =
    coreReady &&
    checks.find((check) => check.name === 'paseo')?.status === 'ok';

  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '○' : '✗';
    process.stdout.write(`${icon} ${check.name}: ${check.detail}\n`);
  }
  process.stdout.write(`\nready.core=${coreReady}\n`);
  process.stdout.write(`ready.scenario=${scenarioReady}\n`);
  process.stdout.write(`ready.runtime=${runtimeReady}\n`);
  process.stdout.write(
    `${JSON.stringify({ event: 'agent_server_doctor', coreReady, scenarioReady, runtimeReady, checks })}\n`,
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
