import { createHash } from 'node:crypto';
import { access, constants, mkdir, readFile, readlink } from 'node:fs/promises';
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
const providerToolchainSourceRoot = resolve(
  repositoryRoot,
  'provider-toolchain',
);
const providerToolchainInputFiles = [
  'providers.manifest.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'patches/@getpaseo__server@0.1.110.patch',
  'scripts/provider-toolchain.mjs',
];

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

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function providerTarget(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  if (process.arch === 'x64') return 'linux-amd64';
  if (process.arch === 'arm64') return 'linux-arm64';
  return undefined;
}

async function currentToolchainDigest(): Promise<string> {
  const hash = createHash('sha256');
  for (const file of providerToolchainInputFiles) {
    hash.update(`provider-toolchain/${file}`);
    hash.update(await readFile(join(providerToolchainSourceRoot, file)));
  }
  return hash.digest('hex');
}

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

export async function findInstalledProviderToolchain(): Promise<
  typeof providerToolchainPaths | undefined
> {
  try {
    const target = providerTarget();
    if (!target) return undefined;
    const manifest = JSON.parse(
      await readFile(providerToolchainManifest, 'utf8'),
    );
    const manifestDigest = sha256(Buffer.from(stable(manifest)));
    const current = await readlink(join(providerToolchainRoot, 'current'));
    if (current !== `releases/${manifestDigest}`) return undefined;
    const releaseRoot = join(providerToolchainRoot, 'releases', manifestDigest);
    const ready = await readFile(join(releaseRoot, '.ready'), 'utf8');
    if (ready.trim() !== manifestDigest) return undefined;
    const release = JSON.parse(
      await readFile(join(releaseRoot, 'release.json'), 'utf8'),
    ) as { toolchainDigest?: unknown; target?: unknown };
    if (
      release.toolchainDigest !== (await currentToolchainDigest()) ||
      release.target !== target
    )
      return undefined;
    await assertProviderExecutables();
    return providerToolchainPaths;
  } catch {
    return undefined;
  }
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
  const setup = process.argv.includes('--fast')
    ? findInstalledProviderToolchain().then(
        (paths) => paths ?? setupProviders(),
      )
    : setupProviders();
  setup
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
