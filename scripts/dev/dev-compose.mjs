import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const compose = resolve(repositoryRoot, 'scripts/dev/docker-compose');
const configurations = {
  core: {
    files: ['compose.yaml', 'compose.core.yaml'],
    services: ['postgres', 'agent-server'],
    project: 'core',
  },
  runtime: {
    files: [
      'compose.yaml',
      'compose.runtime.yaml',
      'compose.external-runtime.yaml',
    ],
    services: [
      'provider-toolchain-init',
      'paseo-runtime-state-init',
      'paseo-runtime',
      'agent-server',
    ],
    project: 'runtime',
  },
};

const configuration = configurations[process.argv[2]];
if (!configuration) {
  process.stderr.write('Usage: pnpm dev:core | pnpm dev:runtime\n');
  process.exitCode = 2;
} else {
  const project =
    process.env.COMPOSE_PROJECT_NAME?.trim() || configuration.project;
  const args = ['-p', project];
  for (const file of configuration.files) args.push('-f', file);
  args.push('up', '--build', '-d', '--wait', ...configuration.services);

  const child = spawn(compose, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  child.once('error', () => {
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
