#!/usr/bin/env node
/**
 * Deploy-time provider volume manager. The volume is disposable cache, while
 * the checked-in manifest and frozen toolchain lock are the authority.
 *
 * Commands: stamp, status, init, attach, validate.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolchainRoot = resolve(here, '..');
const manifestPath = process.env.PROVIDER_MANIFEST
  ? resolve(process.env.PROVIDER_MANIFEST)
  : join(toolchainRoot, 'providers.manifest.json');
const volumeRoot = resolve(
  process.env.PROVIDER_VOLUME_ROOT ?? '/opt/provider-toolchain-volume',
);
const statusPath = join(volumeRoot, 'status.json');
const lockPath = join(volumeRoot, '.init.lock');
const exitCodes = {
  download_failed: 20,
  checksum_mismatch: 21,
  install_failed: 22,
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const manifestDigest = sha256(Buffer.from(stable(manifest)));
const toolchainInputFiles = [
  'providers.manifest.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'patches/@getpaseo__server@0.1.110.patch',
  'scripts/provider-toolchain.mjs',
];

async function computeToolchainDigest() {
  const hash = createHash('sha256');
  for (const file of toolchainInputFiles) {
    hash.update(`provider-toolchain/${file}`);
    hash.update(await readFile(join(toolchainRoot, file)));
  }
  return hash.digest('hex');
}

const toolchainDigest = await computeToolchainDigest();

function targetKey() {
  if (process.platform !== 'linux')
    throw new Error('provider toolchain supports Linux only');
  if (process.arch === 'x64') return 'linux-amd64';
  if (process.arch === 'arm64') return 'linux-arm64';
  throw new Error(`unsupported provider architecture: ${process.arch}`);
}

async function setStatus(status, detail = {}) {
  await mkdir(volumeRoot, { recursive: true });
  const temporary = `${statusPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ schemaVersion: 1, manifestDigest, toolchainDigest, status, ...detail }, null, 2)}\n`,
    { mode: 0o644 },
  );
  await rename(temporary, statusPath);
}

function failureStatus(error) {
  if (error?.code === 'DOWNLOAD_FAILED') return 'download_failed';
  if (error?.code === 'CHECKSUM_MISMATCH') return 'checksum_mismatch';
  return 'install_failed';
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function envKey(prefix, provider) {
  return `${prefix}_${provider.toUpperCase().replaceAll('-', '_')}`;
}

function hasExactVersionToken(value, expectedVersion) {
  return value
    .split(/[\/_-]+/u)
    .some(
      (token) => token === expectedVersion || token === `v${expectedVersion}`,
    );
}

async function digestFile(path) {
  return sha256(await readFile(path));
}

async function downloadArtifact(provider, artifact, destination) {
  const fileOverride =
    process.env[envKey('PROVIDER_ARTIFACT', provider) + '_FILE'];
  if (fileOverride) {
    await cp(resolve(fileOverride), destination);
  } else {
    const base = process.env.PROVIDER_ARTIFACT_BASE_URL?.replace(/\/$/u, '');
    const url = base
      ? `${base}/${provider}/${artifact.url.split('/').at(-1)}`
      : artifact.url;
    if (!/^https:\/\//u.test(url) || /latest/iu.test(url))
      fail('CHECKSUM_MISMATCH', `artifact URL is not immutable: ${url}`);
    if (
      !base &&
      !hasExactVersionToken(
        new URL(artifact.url).pathname,
        manifest.providers[provider].version,
      )
    )
      fail(
        'CHECKSUM_MISMATCH',
        `artifact URL does not contain exact provider version: ${provider}`,
      );
    let response;
    try {
      response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const wrapped = new Error(
        `provider artifact download failed: ${provider}`,
      );
      wrapped.code = 'DOWNLOAD_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
  }
  const expected =
    process.env[envKey('PROVIDER_ARTIFACT', provider) + '_SHA256'] ??
    artifact.sha256;
  if (!expected || !/^[0-9a-f]{64}$/u.test(expected))
    fail(
      'CHECKSUM_MISMATCH',
      `provider artifact checksum TODO/missing: ${provider}`,
    );
  const actual = await digestFile(destination);
  if (actual !== expected.toLowerCase())
    fail(
      'CHECKSUM_MISMATCH',
      `provider artifact checksum mismatch: ${provider}`,
    );
}

async function findExecutable(root, provider) {
  const candidates = [
    provider,
    provider === 'opencode' ? 'opencode' : null,
    provider === 'codex'
      ? `codex-${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-unknown-linux-musl`
      : null,
  ].filter(Boolean);
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (candidates.includes(entry.name)) {
        try {
          await access(path, constants.X_OK);
          return path;
        } catch {}
      }
    }
  }
  return null;
}

async function installProvider(provider, artifact, releaseRoot) {
  const temp = join(releaseRoot, `.artifact-${provider}`);
  await mkdir(temp, { recursive: true });
  const archive = join(temp, 'artifact');
  await downloadArtifact(provider, artifact, archive);
  const extract = join(temp, 'extract');
  await mkdir(extract, { recursive: true });
  let binary = null;
  const isExecutable =
    (await readFile(archive)).subarray(0, 4).toString('hex') === '7f454c46';
  if (isExecutable) binary = archive;
  else {
    const result = spawnSync('tar', ['-xzf', archive, '-C', extract], {
      encoding: 'utf8',
    });
    if (result.status !== 0)
      fail(
        'CHECKSUM_MISMATCH',
        `provider archive could not be extracted: ${provider}`,
      );
    binary = await findExecutable(extract, provider);
  }
  if (!binary)
    fail(
      'CHECKSUM_MISMATCH',
      `provider executable missing from artifact: ${provider}`,
    );
  const target = join(releaseRoot, 'bin', provider);
  await mkdir(dirname(target), { recursive: true });
  await cp(binary, target);
  await chmod(target, 0o755);
  const expectedBinary =
    process.env[envKey('PROVIDER_BINARY', provider) + '_SHA256'] ??
    artifact.binarySha256;
  if (!expectedBinary || !/^[0-9a-f]{64}$/u.test(expectedBinary))
    fail(
      'CHECKSUM_MISMATCH',
      `installed binary checksum TODO/missing: ${provider}`,
    );
  const actualBinary = await digestFile(target);
  if (actualBinary !== expectedBinary.toLowerCase())
    fail(
      'CHECKSUM_MISMATCH',
      `installed binary checksum mismatch: ${provider}`,
    );
  const version = spawnSync(target, ['--version'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  const output = `${version.stdout ?? ''}\n${version.stderr ?? ''}`;
  const expectedVersion = manifest.providers[provider].version;
  const versionTokens = output.split(/[^0-9A-Za-z.-]+/u).filter(Boolean);
  if (version.status !== 0 || !versionTokens.includes(expectedVersion))
    fail(
      'CHECKSUM_MISMATCH',
      `provider version mismatch: ${provider} expected ${expectedVersion}`,
    );
  await rm(temp, { recursive: true, force: true });
  return {
    path: `bin/${provider}`,
    sha256: actualBinary,
    version: output.trim().split(/\s+/u).slice(0, 4).join(' '),
  };
}

async function installPaseo(staging) {
  const paseo = join(staging, 'paseo-toolchain');
  await mkdir(paseo, { recursive: true });
  await Promise.all([
    cp(join(toolchainRoot, 'package.json'), join(paseo, 'package.json')),
    cp(join(toolchainRoot, 'pnpm-lock.yaml'), join(paseo, 'pnpm-lock.yaml')),
    cp(
      join(toolchainRoot, 'pnpm-workspace.yaml'),
      join(paseo, 'pnpm-workspace.yaml'),
    ),
    cp(join(toolchainRoot, 'patches'), join(paseo, 'patches'), {
      recursive: true,
    }),
  ]);
  const result = spawnSync(
    'pnpm',
    ['install', '--dir', paseo, '--frozen-lockfile'],
    {
      encoding: 'utf8',
      stdio: 'inherit',
    },
  );
  if (result.status !== 0)
    fail('DOWNLOAD_FAILED', 'Paseo toolchain frozen install failed');
  const paseoBin = join(paseo, 'node_modules', '.bin', 'paseo');
  try {
    await access(paseoBin, constants.X_OK);
  } catch {
    fail('CHECKSUM_MISMATCH', 'paseo binary missing after frozen install');
  }
  return 'paseo-toolchain/node_modules/.bin/paseo';
}

async function validateRelease(releaseRoot, { requireReady = true } = {}) {
  if (requireReady) {
    const ready = await readFile(join(releaseRoot, '.ready'), 'utf8').catch(
      () => '',
    );
    if (ready.trim() !== manifestDigest)
      fail('CHECKSUM_MISMATCH', 'provider release ready marker mismatch');
  }
  const record = JSON.parse(
    await readFile(join(releaseRoot, 'release.json'), 'utf8'),
  );
  if (
    record.manifestDigest !== manifestDigest ||
    record.toolchainDigest !== toolchainDigest ||
    record.target !== targetKey()
  )
    fail(
      'CHECKSUM_MISMATCH',
      'provider release toolchain digest or target mismatch',
    );
  const expectedProviders = Object.keys(manifest.providers).sort();
  const installedProviders = Object.keys(record.providers ?? {}).sort();
  if (stable(installedProviders) !== stable(expectedProviders))
    fail('CHECKSUM_MISMATCH', 'provider release set mismatch');
  for (const [provider, item] of Object.entries(record.providers)) {
    const binary = join(releaseRoot, item.path);
    const expectedBinary =
      manifest.providers[provider].artifacts[targetKey()].binarySha256;
    if ((await digestFile(binary)) !== expectedBinary)
      fail(
        'CHECKSUM_MISMATCH',
        `provider binary checksum mismatch: ${provider}`,
      );
    try {
      await access(binary, constants.X_OK);
    } catch {
      fail('CHECKSUM_MISMATCH', `provider binary not executable: ${provider}`);
    }
  }
  const paseoBinary = join(releaseRoot, record.paseo?.path ?? '');
  try {
    await access(paseoBinary, constants.X_OK);
  } catch {
    fail('CHECKSUM_MISMATCH', 'paseo binary missing from release');
  }
  const paseoVersion = spawnSync(paseoBinary, ['--version'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  const paseoOutput = `${paseoVersion.stdout ?? ''}\n${paseoVersion.stderr ?? ''}`;
  if (
    paseoVersion.status !== 0 ||
    !paseoOutput
      .split(/[^0-9A-Za-z.-]+/u)
      .filter(Boolean)
      .includes(manifest.toolchain.paseo.version)
  )
    fail(
      'CHECKSUM_MISMATCH',
      `paseo version mismatch: expected ${manifest.toolchain.paseo.version}`,
    );
  const patch = manifest.toolchain.serverPatch;
  const patchPath = join(
    releaseRoot,
    'paseo-toolchain',
    'patches',
    patch.path.split('/').at(-1),
  );
  if ((await digestFile(patchPath)) !== patch.sha256)
    fail('CHECKSUM_MISMATCH', 'Paseo server patch checksum mismatch');
  const serverDir = join(
    releaseRoot,
    'paseo-toolchain',
    'node_modules',
    '.pnpm',
  );
  const serverFiles = [];
  const walk = async (root) => {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (
        entry.name === 'server-manager.js' ||
        entry.name === 'opencode-agent.js'
      )
        serverFiles.push(path);
    }
  };
  try {
    await walk(serverDir);
  } catch {
    fail('CHECKSUM_MISMATCH', 'Paseo server output missing');
  }
  for (const marker of patch.markers) {
    let found = false;
    for (const path of serverFiles)
      if ((await readFile(path, 'utf8')).includes(marker)) found = true;
    if (!found)
      fail('CHECKSUM_MISMATCH', `Paseo patch marker missing: ${marker}`);
  }
  return record;
}

async function lockedInit() {
  await mkdir(volumeRoot, { recursive: true });
  const existing = join(volumeRoot, 'releases', manifestDigest);
  if (
    await access(join(existing, '.ready'))
      .then(() => true)
      .catch(() => false)
  ) {
    try {
      await validateRelease(existing);
      await activateRelease(existing);
      await setStatus('ready', {
        release: `releases/${manifestDigest}`,
        target: targetKey(),
        reused: true,
      });
      return;
    } catch {
      await rm(existing, { recursive: true, force: true });
    }
  }
  for (const entry of await readdir(volumeRoot, { withFileTypes: true }))
    if (entry.name.startsWith('staging-'))
      await rm(join(volumeRoot, entry.name), { recursive: true, force: true });
  const staging = join(volumeRoot, `staging-${process.pid}-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  await setStatus('installing', {
    staging: staging.split('/').at(-1),
    target: targetKey(),
  });
  try {
    const paseoPath = await installPaseo(staging);
    const providers = {};
    for (const [name, definition] of Object.entries(manifest.providers)) {
      const artifact = definition.artifacts[targetKey()];
      if (!artifact)
        fail('CHECKSUM_MISMATCH', `no artifact for ${name}/${targetKey()}`);
      providers[name] = await installProvider(name, artifact, staging);
      const marker = process.env.PROVIDER_TOOLCHAIN_WRITER_MARKER;
      if (marker) await writeFile(resolve(marker), `${name}\n`, { flag: 'a' });
      if (process.env.PROVIDER_TOOLCHAIN_PAUSE_FILE) {
        while (
          await access(process.env.PROVIDER_TOOLCHAIN_PAUSE_FILE)
            .then(() => true)
            .catch(() => false)
        )
          await new Promise((resolvePause) => setTimeout(resolvePause, 100));
      }
      if (process.env.PROVIDER_TOOLCHAIN_KILL_HOOK && name === 'opencode') {
        spawnSync(process.env.PROVIDER_TOOLCHAIN_KILL_HOOK, {
          shell: true,
          stdio: 'inherit',
        });
      }
    }
    const record = {
      schemaVersion: 1,
      manifestDigest,
      toolchainDigest,
      target: targetKey(),
      paseo: { path: paseoPath },
      providers,
    };
    await writeFile(
      join(staging, 'release.json'),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    await validateRelease(staging, { requireReady: false });
    await writeFile(join(staging, '.ready'), `${manifestDigest}\n`);
    await validateRelease(staging);
    const finalRoot = join(volumeRoot, 'releases', manifestDigest);
    await mkdir(join(volumeRoot, 'releases'), { recursive: true });
    await rm(finalRoot, { recursive: true, force: true });
    await rename(staging, finalRoot);
    await activateRelease(finalRoot);
    await setStatus('ready', {
      release: `releases/${manifestDigest}`,
      target: targetKey(),
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    const status = failureStatus(error);
    await setStatus(status, {
      message: error instanceof Error ? error.message : String(error),
    });
    error.exitCode = exitCodes[status] ?? 1;
    throw error;
  }
}

async function activateRelease(releaseRoot) {
  const expected = join(volumeRoot, 'releases', manifestDigest);
  if (resolve(releaseRoot) !== resolve(expected))
    fail(
      'CHECKSUM_MISMATCH',
      'refusing to activate an unexpected provider release path',
    );
  const currentTmp = join(
    volumeRoot,
    `.current-${process.pid}-${randomUUID()}`,
  );
  await symlink(`releases/${manifestDigest}`, currentTmp);
  try {
    await rename(currentTmp, join(volumeRoot, 'current'));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await unlink(join(volumeRoot, 'current'));
    await rename(currentTmp, join(volumeRoot, 'current'));
  }
}

async function validateActivatedRelease() {
  const expected = join(volumeRoot, 'releases', manifestDigest);
  const current = join(volumeRoot, 'current');
  let target;
  try {
    target = await readlink(current);
  } catch {
    fail('CHECKSUM_MISMATCH', 'provider current release link is missing');
  }
  if (resolve(dirname(current), target) !== resolve(expected))
    fail(
      'CHECKSUM_MISMATCH',
      'provider current release link points to an unexpected release',
    );
  return validateRelease(expected);
}

async function runLocked(command) {
  if (process.env.PROVIDER_TOOLCHAIN_LOCKED === '1') {
    await command();
    return;
  }
  await mkdir(volumeRoot, { recursive: true });
  const result = spawnSync(
    'flock',
    [
      '-x',
      lockPath,
      process.execPath,
      fileURLToPath(import.meta.url),
      commandName,
      '--locked',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, PROVIDER_TOOLCHAIN_LOCKED: '1' },
    },
  );
  process.exitCode = result.status ?? 1;
}

const commandName = process.argv[2] ?? 'status';
try {
  if (commandName === 'stamp') process.stdout.write(`${toolchainDigest}\n`);
  else if (commandName === 'status') {
    let status;
    try {
      status = JSON.parse(await readFile(statusPath, 'utf8'));
    } catch {
      status = {
        schemaVersion: 1,
        manifestDigest,
        toolchainDigest,
        status: 'not_installed',
      };
    }
    if (status.status === 'installing') {
      const lockProbe = spawnSync('flock', ['-n', lockPath, 'true']);
      if (lockProbe.status === 0) {
        status = {
          schemaVersion: 1,
          manifestDigest,
          toolchainDigest,
          status: 'not_installed',
          reason: 'incomplete_previous_install',
          staleStaging: status.staging ?? null,
        };
      }
    }
    if (status.status === 'ready') {
      try {
        await validateActivatedRelease();
      } catch (error) {
        status = {
          schemaVersion: 1,
          manifestDigest,
          toolchainDigest,
          status: 'not_installed',
          reason: 'current_release_invalid',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } else if (commandName === 'init') await runLocked(lockedInit);
  else if (commandName === 'attach' || commandName === 'validate') {
    const release = join(volumeRoot, 'releases', manifestDigest);
    await validateActivatedRelease();
    process.stdout.write(
      `${JSON.stringify({ status: 'ready', manifestDigest, toolchainDigest, release })}\n`,
    );
  } else throw new Error(`unknown provider toolchain command: ${commandName}`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = error?.exitCode ?? 1;
}
