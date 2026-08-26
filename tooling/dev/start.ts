import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';

import {
  hostCoreEnvironment,
  hostRuntimeEnvironment,
  hostWebEnvironment,
  prepareHostNativeEnvironment,
  repositoryRoot,
  runCommand,
  spawnOwned,
  stopOwned,
  waitForHttp,
} from './host-native.js';
import {
  CORE_READINESS_TIMEOUT_MS,
  runtimeReadinessTimeout,
} from './readiness-timeout.js';

export type HostDevMode = 'core' | 'runtime';

function parseMode(value: string | undefined): HostDevMode {
  if (!value || value === 'core') return 'core';
  if (value === 'runtime' || value === 'full') return 'runtime';
  throw new Error('usage: pnpm dev[:runtime] (supported modes: core, runtime)');
}

async function readGeneratedWebEnv(): Promise<NodeJS.ProcessEnv> {
  try {
    const contents = await readFile(
      resolve(repositoryRoot, '.local/web-bootstrap.env'),
      'utf8',
    );
    const result: NodeJS.ProcessEnv = {};
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const index = line.indexOf('=');
      if (index <= 0) continue;
      const name = line.slice(0, index);
      let value = line.slice(index + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      result[name] = value;
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function describeRuntimeBanner(environment: NodeJS.ProcessEnv): string {
  const adapter = environment.RUNTIME_ADAPTER ?? 'none';
  const directChatPlane = environment.AGENT_SERVER_DIRECT_CHAT_PLANE ?? 'mock';
  const productWorkPlane =
    environment.AGENT_SERVER_PRODUCT_WORK_PLANE ?? 'absent';
  return `runtime=${adapter} (direct-chat=${directChatPlane}, product-work=${productWorkPlane})`;
}

function exitOf(
  child: ChildProcess,
): Promise<{ code: number; signal: string | null }> {
  return new Promise((resolveExit) => {
    child.once('error', () => resolveExit({ code: 1, signal: null }));
    child.once('exit', (code, signal) =>
      resolveExit({ code: code ?? (signal ? 1 : 0), signal }),
    );
  });
}

export async function startHostDevelopment(
  mode: HostDevMode,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const prepared = await prepareHostNativeEnvironment(environment);
  const applicationEnvironment =
    mode === 'runtime'
      ? hostRuntimeEnvironment(prepared)
      : hostCoreEnvironment(prepared);
  const readinessTimeoutMs =
    mode === 'runtime'
      ? runtimeReadinessTimeout(applicationEnvironment)
      : CORE_READINESS_TIMEOUT_MS;
  const apiPort = Number.parseInt(applicationEnvironment.PORT ?? '3000', 10);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const children: ChildProcess[] = [];
  let stopping = false;
  let signalResolve: (() => void) | undefined;
  const signal = new Promise<void>((resolveSignal) => {
    signalResolve = resolveSignal;
  });
  const requestStop = () => {
    if (stopping) return;
    stopping = true;
    signalResolve?.();
  };
  for (const name of ['SIGINT', 'SIGTERM'] as const)
    process.once(name, requestStop);

  try {
    const watch =
      applicationEnvironment.HOST_NATIVE_WATCH?.trim().toLowerCase();
    const apiArgs = [
      '--import',
      'tsx',
      ...(watch === '0' || watch === 'false' || watch === 'off'
        ? []
        : ['--watch']),
      'src/entrypoints/api/server.ts',
    ];
    const api =
      mode === 'runtime'
        ? spawnOwned(
            'node',
            ['scripts/dev/with-paseo.mjs', '--', 'node', ...apiArgs],
            { environment: applicationEnvironment },
          )
        : spawnOwned('node', apiArgs, { environment: applicationEnvironment });
    children.push(api);

    await Promise.race([
      waitForHttp(
        `${apiBaseUrl}${mode === 'runtime' ? '/health/ready' : '/health/live'}`,
        readinessTimeoutMs,
      ),
      exitOf(api).then(({ code }) => {
        throw new Error(`Agent Server exited before readiness (${code})`);
      }),
    ]);

    const webBaseEnvironment = hostWebEnvironment({
      ...applicationEnvironment,
      AGENT_SERVER_BASE_URL: apiBaseUrl,
      ...(mode === 'core' ? { WEB_BOOTSTRAP_SKIP_WORK: '1' } : {}),
    });
    await runCommand('node', ['scripts/dev/web-bootstrap.mjs'], {
      environment: webBaseEnvironment,
    });
    const generatedWebEnv = await readGeneratedWebEnv();
    const webEnvironment = hostWebEnvironment({
      ...webBaseEnvironment,
      ...generatedWebEnv,
      AGENT_SERVER_BASE_URL: apiBaseUrl,
    });
    const web = spawnOwned('pnpm', ['web:dev'], {
      environment: webEnvironment,
    });
    children.push(web);

    process.stdout.write(
      [
        `host-native dev ready: mode=${mode}`,
        `api=${apiBaseUrl}`,
        'web=http://127.0.0.1:3001',
        describeRuntimeBanner(applicationEnvironment),
        'bootstrap=agent/environment/team/workspace ready',
        '',
      ].join('\n'),
    );

    const firstExit = Promise.race(
      children.map((child) =>
        exitOf(child).then((result) => ({ type: 'exit' as const, result })),
      ),
    );
    const outcome = await Promise.race([
      firstExit,
      signal.then(() => ({ type: 'signal' as const })),
    ]);
    if (outcome.type === 'exit' && !stopping) {
      process.exitCode = outcome.result.code;
      requestStop();
    }
  } finally {
    await stopOwned(children);
    for (const name of ['SIGINT', 'SIGTERM'] as const)
      process.removeListener(name, requestStop);
  }
}

const mode = parseMode(process.argv[2]);
startHostDevelopment(mode).catch((error: unknown) => {
  process.stderr.write(
    `host-native dev failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
