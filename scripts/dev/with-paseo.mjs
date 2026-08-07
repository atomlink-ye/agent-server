import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from './paseo-process.mjs';
import { copyNamedEnvironment } from './safe-environment.mjs';

const applicationEnvironmentNames = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'LOG_LEVEL',
  'SERVICE_NAME',
  'PASEO_MODEL',
  'PASEO_CONNECT_TIMEOUT_MS',
  'PASEO_EXECUTION_TIMEOUT_MS',
  'AGENT_SERVER_DISPATCHER_CONCURRENCY',
  'DATABASE_URL',
  'POSTGRES_URL',
  'SERVICE_ACCOUNTS_JSON',
];
const paseoEnvironmentNames = [
  'OPENCODE_GO_API_KEY',
  'OPENCODE_CONFIG_CONTENT',
];

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const separator = process.argv.indexOf('--');
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (command.length === 0) {
  process.stderr.write(
    'Usage: node scripts/dev/with-paseo.mjs -- <command> [args...]\n',
  );
  process.exitCode = 2;
} else {
  const runtimeRoot = join(repositoryRoot, '.local', 'dev-runtime');
  const agentWorkspace = join(repositoryRoot, '.local', 'agent-workspace');
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true }),
    mkdir(agentWorkspace, { recursive: true }),
  ]);
  const paseoPort = process.env.PASEO_PORT
    ? Number.parseInt(process.env.PASEO_PORT, 10)
    : await getAvailablePort();
  const paseoListenHost = process.env.PASEO_LISTEN_HOST ?? '127.0.0.1';
  const paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot,
    port: paseoPort,
    listenHost: paseoListenHost,
    environmentVariableNames: paseoEnvironmentNames,
  });

  const child = spawn(command[0], command.slice(1), {
    cwd: repositoryRoot,
    env: {
      ...paseo.environment,
      ...copyNamedEnvironment(process.env, applicationEnvironmentNames),
      PASEO_WS_URL: paseo.wsUrl,
      PASEO_AGENT_CWD: agentWorkspace,
      PASEO_WORKSPACE_TITLE: 'Agent Server Development',
    },
    detached: process.platform !== 'win32',
    stdio: 'inherit',
  });

  const stop = async () => {
    await Promise.all([stopProcessTree(child), stopProcessTree(paseo.child)]);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void stop();
    });
  }

  const exitCode = await new Promise((resolveExit) => {
    child.once('exit', (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
    child.once('error', () => resolveExit(1));
  });
  await stopProcessTree(paseo.child);
  process.exitCode = exitCode;
}
