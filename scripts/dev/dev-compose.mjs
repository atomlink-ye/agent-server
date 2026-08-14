import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDevelopmentProfile } from './harness.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const compose = resolve(repositoryRoot, 'scripts/dev/docker-compose');
const profileName = process.argv[2];
const configuration = profileName
  ? resolveDevelopmentProfile({ profileName })
  : undefined;
if (!configuration) {
  process.stderr.write('Usage: pnpm dev:core | pnpm dev:runtime\n');
  process.exitCode = 2;
} else {
  const project =
    process.env.COMPOSE_PROJECT_NAME?.trim() || configuration.name;
  const args = ['-p', project];
  for (const file of configuration.compose.files) args.push('-f', file);
  args.push('up', '-d', '--wait', ...configuration.services);

  const child = spawn(compose, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...(configuration.runtime?.provider
        ? { PASEO_PROVIDER: configuration.runtime.provider }
        : {}),
      ...(configuration.runtime?.model
        ? { PASEO_MODEL: configuration.runtime.model }
        : {}),
    },
    stdio: 'inherit',
  });
  child.once('error', () => {
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
