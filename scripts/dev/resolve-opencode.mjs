import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSafeRuntimeEnvironment } from './safe-environment.mjs';

const require = createRequire(import.meta.url);

const packages = new Map([
  ['linux-x64', 'opencode-linux-x64'],
  ['linux-arm64', 'opencode-linux-arm64'],
  ['darwin-x64', 'opencode-darwin-x64'],
  ['darwin-arm64', 'opencode-darwin-arm64'],
]);

export async function resolveOpenCodeBinary() {
  if (process.env.OPENCODE_BIN) {
    await access(process.env.OPENCODE_BIN, constants.X_OK);
    return process.env.OPENCODE_BIN;
  }

  const packageName = packages.get(`${process.platform}-${process.arch}`);
  if (!packageName) {
    throw new Error(
      `Unsupported OpenCode platform: ${process.platform}-${process.arch}. ` +
        'The baseline supports Linux and macOS on x64 or arm64.',
    );
  }

  let packageJson;
  try {
    packageJson = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(
      `${packageName} is not installed. Run "make setup" before starting Paseo.`,
    );
  }
  const binary = join(dirname(packageJson), 'bin', 'opencode');
  await access(binary, constants.X_OK);
  return binary;
}

export async function verifyOpenCodeBinary() {
  const binary = await resolveOpenCodeBinary();
  const home = await mkdtemp(join(tmpdir(), 'agent-server-opencode-check-'));
  try {
    const xdgData = join(home, 'xdg-data');
    const xdgConfig = join(home, 'xdg-config');
    const xdgCache = join(home, 'xdg-cache');
    await Promise.all(
      [xdgData, xdgConfig, xdgCache].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    );
    const result = spawnSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...createSafeRuntimeEnvironment(),
        HOME: home,
        XDG_DATA_HOME: xdgData,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_CACHE_HOME: xdgCache,
      },
    });
    if (result.status !== 0) {
      throw new Error(
        `OpenCode binary check failed: ${result.stderr || result.error?.message || 'unknown error'}`,
      );
    }
    return { binary, version: result.stdout.trim() };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const result = process.argv.includes('--check')
    ? await verifyOpenCodeBinary()
    : { binary: await resolveOpenCodeBinary() };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
