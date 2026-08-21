import { access, constants, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const providerToolchainRoot = resolve(
  repositoryRoot,
  '.local/provider-toolchain',
);
export const providerToolchainManifest = resolve(
  repositoryRoot,
  'provider-toolchain/providers.manifest.json',
);
const providerToolchainScript = resolve(
  repositoryRoot,
  'provider-toolchain/scripts/provider-toolchain.mjs',
);

export const providerToolchainPaths = Object.freeze({
  root: providerToolchainRoot,
  paseo: resolve(
    providerToolchainRoot,
    'current/paseo-toolchain/node_modules/.bin/paseo',
  ),
  opencode: resolve(providerToolchainRoot, 'current/bin/opencode'),
  claude: resolve(providerToolchainRoot, 'current/bin/claude'),
  codex: resolve(providerToolchainRoot, 'current/bin/codex'),
});

type ProviderToolchainCommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

function redactOutput(output: string, environment: NodeJS.ProcessEnv): string {
  return Object.entries(environment).reduce((result, [name, value]) => {
    if (
      !/(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)/iu.test(name) ||
      !value?.trim()
    ) {
      return result;
    }
    return result.replaceAll(value.trim(), '[redacted]');
  }, output);
}

function boundedTail(output: string, environment: NodeJS.ProcessEnv): string {
  const redacted = redactOutput(output, environment).trim();
  if (!redacted) return '';
  return redacted.split(/\r?\n/u).slice(-30).join('\n').slice(-4_000);
}

function providerToolchainEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    PROVIDER_VOLUME_ROOT: providerToolchainRoot,
    PROVIDER_MANIFEST: providerToolchainManifest,
    HOME: join(providerToolchainRoot, 'home'),
    PNPM_HOME: join(providerToolchainRoot, 'pnpm'),
  };
}

async function commandAvailable(
  command: string,
  environment: NodeJS.ProcessEnv,
): Promise<boolean> {
  for (const directory of (environment.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    try {
      await access(join(directory, command), constants.X_OK);
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }
  return false;
}

async function assertLinuxPrerequisites(
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  if (process.platform !== 'linux') {
    throw new Error('provider setup requires a Linux runtime');
  }
  if (!(await commandAvailable('flock', environment))) {
    throw new Error('provider setup requires flock');
  }
}

function runProviderToolchainCommand(
  command: string,
  environment: NodeJS.ProcessEnv,
): Promise<ProviderToolchainCommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(process.execPath, [providerToolchainScript, command], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', rejectCommand);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveCommand({ stdout, stderr });
        return;
      }
      rejectCommand(
        new Error(
          [
            `provider toolchain ${command} failed (${code ?? signal ?? 'unknown'})`,
            boundedTail(
              [stdout, stderr].filter(Boolean).join('\n'),
              environment,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      );
    });
  });
}

async function assertExecutable(path: string, name: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error(`provider toolchain ${name} is unavailable after init`);
  }
}

async function assertProviderExecutables(): Promise<void> {
  await Promise.all([
    assertExecutable(providerToolchainPaths.paseo, 'Paseo'),
    assertExecutable(providerToolchainPaths.opencode, 'OpenCode'),
    assertExecutable(providerToolchainPaths.claude, 'Claude'),
    assertExecutable(providerToolchainPaths.codex, 'Codex'),
  ]);
}

export async function setupProviders(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<typeof providerToolchainPaths> {
  await assertLinuxPrerequisites(environment);
  await mkdir(providerToolchainRoot, { recursive: true });
  await runProviderToolchainCommand(
    'init',
    providerToolchainEnvironment(environment),
  );
  await assertProviderExecutables();
  return providerToolchainPaths;
}

export async function validateProviders(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<typeof providerToolchainPaths> {
  await assertLinuxPrerequisites(environment);
  await runProviderToolchainCommand(
    'validate',
    providerToolchainEnvironment(environment),
  );
  await assertProviderExecutables();
  return providerToolchainPaths;
}

function isEntrypoint(): boolean {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isEntrypoint()) {
  const json = process.argv.includes('--json');
  setupProviders()
    .then((paths) => {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ status: 'ready', binaries: paths })}\n`,
        );
        return;
      }
      process.stdout.write(
        [
          'provider setup ready',
          'provider_toolchain=installed',
          'paseo=installed',
          'opencode=installed',
          'claude=installed',
          'codex=installed',
          '',
        ].join('\n'),
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `provider setup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
