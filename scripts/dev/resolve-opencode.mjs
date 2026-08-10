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

// `opencode` is a ~100MB Bun-compiled binary, so the first exec has to page the
// whole thing in. On a sandbox host using the fuse-overlayfs storage driver that
// alone can exceed ten seconds, and the original 15s budget — calibrated against
// a local SSD — turned into a recurring build failure that reads like a broken
// binary rather than a slow disk. The gate is "the binary exists and runs", not
// "it runs within N ms", so the budget is generous and overridable.
const CHECK_TIMEOUT_MS = Number(
  process.env.OPENCODE_CHECK_TIMEOUT_MS ?? 120_000,
);

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
      timeout: CHECK_TIMEOUT_MS,
      env: {
        ...createSafeRuntimeEnvironment(),
        HOME: home,
        XDG_DATA_HOME: xdgData,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_CACHE_HOME: xdgCache,
      },
    });
    if (result.status !== 0) {
      // Name the timeout explicitly. "ETIMEDOUT" on its own has repeatedly been
      // read as a corrupt binary, prompting attempts to patch or skip the check
      // when the actual problem was a slow host.
      const detail =
        result.error?.code === 'ETIMEDOUT'
          ? `did not respond within ${CHECK_TIMEOUT_MS}ms; this is a slow-host symptom, not a broken binary. Raise OPENCODE_CHECK_TIMEOUT_MS rather than skipping this check.`
          : result.stderr || result.error?.message || 'unknown error';
      throw new Error(`OpenCode binary check failed: ${detail}`);
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
