import type { ChildProcess } from 'node:child_process';

import {
  LOCAL_SERVICE_TOKEN,
  LOCAL_WORKSPACE_ID,
  hostWebEnvironment,
  loadLocalDotEnv,
  repositoryRoot,
  runCommand,
  spawnOwned,
  stopOwned,
  waitForHttp,
} from './host-native.js';

export type CanaryKind = 'runtime' | 'golden-path';

function parseKind(value: string | undefined): CanaryKind {
  if (value === 'runtime' || value === 'golden-path') return value;
  throw new Error('usage: run-canary.ts <runtime|golden-path>');
}

export async function runHostCanary(
  kind: CanaryKind,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const loaded = await loadLocalDotEnv(environment);
  const children: ChildProcess[] = [];
  try {
    const dev = spawnOwned(
      'node',
      ['--import', 'tsx', 'tooling/dev/start.ts', 'runtime'],
      { environment: loaded },
    );
    children.push(dev);
    await waitForHttp('http://127.0.0.1:3000/health/ready', 90_000);
    await waitForHttp('http://127.0.0.1:3001', 90_000);

    const commandEnvironment = hostWebEnvironment({
      ...loaded,
      AGENT_SERVER_BASE_URL: 'http://127.0.0.1:3000',
      AGENT_SERVER_SERVICE_TOKEN:
        loaded.AGENT_SERVER_SERVICE_TOKEN?.trim() || LOCAL_SERVICE_TOKEN,
      AGENT_SERVER_WORKSPACE_ID:
        loaded.AGENT_SERVER_WORKSPACE_ID?.trim() || LOCAL_WORKSPACE_ID,
      WEB_E2E_BASE_URL: loaded.WEB_E2E_BASE_URL?.trim() || 'http://127.0.0.1:3001',
    });

    if (kind === 'runtime') {
      await runCommand('node', ['scripts/smoke/runtime-main-flow.mjs'], {
        environment: commandEnvironment,
        cwd: repositoryRoot,
      });
    } else {
      await runCommand(
        'pnpm',
        [
          'exec',
          'vitest',
          'run',
          '--config',
          'vitest.e2e.config.ts',
          'e2e/web-product-session.e2e.test.ts',
        ],
        { environment: commandEnvironment, cwd: repositoryRoot },
      );
    }
  } finally {
    await stopOwned(children);
  }
}

runHostCanary(parseKind(process.argv[2])).catch((error: unknown) => {
  process.stderr.write(
    `canary failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
