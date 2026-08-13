import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { registerSkill } from '../../src/application/extensions/skill-registry.ts';
import { LocalSkillCatalog } from '../../src/infrastructure/filesystem/local-skill-catalog.ts';
import { materializeOpenCodeSkill } from '../../src/infrastructure/filesystem/opencode-skill-materializer.ts';
import {
  AGENT_SERVER_MEMORY_API_SKILL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
} from '../../src/application/agents/built-in-skills.ts';
import { PaseoSdkClient } from '../../src/adapters/paseo/paseo-client-port.ts';
import { selectOpenCodeModel } from '../../src/adapters/paseo/model-selector.ts';
import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from '../dev/paseo-process.mjs';
import { resolveOpenCodeBinary } from '../dev/resolve-opencode.mjs';
import { resolvePaseoBinary } from '../dev/resolve-paseo.mjs';

const root = resolve(
  join(
    fileURLToPath(new URL('../..', import.meta.url)),
    '.local',
    'skill-smoke',
    `${process.pid}-${randomUUID()}`,
  ),
);
const projectCwd = join(root, 'project');
const registryRoot = join(root, 'skill-registry');
const repositoryRoot = resolve(
  join(fileURLToPath(new URL('.', import.meta.url)), '../..'),
);
const execFileAsync = promisify(execFile);
let paseo;
let client;
let stage = 'setup';
try {
  await mkdir(projectCwd, { recursive: true });
  const skill = await registerSkill({
    registryRoot,
    ref: AGENT_SERVER_MEMORY_API_SKILL_REF,
    name: AGENT_SERVER_MEMORY_API_SKILL_REF,
    sourceRoot: join(repositoryRoot, 'skills/agent-server-memory-api'),
    requiredToolRefs: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
  });
  const repeat = await registerSkill({
    registryRoot,
    ref: AGENT_SERVER_MEMORY_API_SKILL_REF,
    name: AGENT_SERVER_MEMORY_API_SKILL_REF,
    sourceRoot: join(repositoryRoot, 'skills/agent-server-memory-api'),
    requiredToolRefs: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
  });
  if (repeat.digest !== skill.digest || repeat.objectPath !== skill.objectPath)
    throw new Error('Skill digest is not deterministic.');
  const catalogSkill = await new LocalSkillCatalog(registryRoot).resolve(
    AGENT_SERVER_MEMORY_API_SKILL_REF,
  );
  if (!catalogSkill || catalogSkill.digest !== skill.digest)
    throw new Error('Skill catalog resolution mismatch.');
  const materialized = await materializeOpenCodeSkill({
    projectCwd,
    runtimeRoot: root,
    registryRoot,
    skill: catalogSkill,
  });
  const linkStat = await lstat(materialized.target);
  const linkRealPath = await realpath(materialized.target);
  if (
    !linkStat.isSymbolicLink() ||
    linkRealPath !== (await realpath(catalogSkill.objectPath)) ||
    !linkRealPath.startsWith(`${await realpath(registryRoot)}/`)
  )
    throw new Error(
      'Skill materialization did not produce the expected symlink.',
    );
  const receiptStat = await lstat(materialized.receiptPath);
  const logicalManifest = JSON.parse(
    await readFile(catalogSkill.manifestPath, 'utf8'),
  );
  const objectManifestPath = join(catalogSkill.objectPath, 'manifest.json');
  const objectManifest = JSON.parse(await readFile(objectManifestPath, 'utf8'));
  const receipt = JSON.parse(await readFile(materialized.receiptPath, 'utf8'));
  const expectedRefFields = [
    'format',
    'ref',
    'name',
    'digest',
    'delivery',
    'requiredToolRefs',
    'object',
  ];
  if (
    !sameKeys(logicalManifest, expectedRefFields) ||
    logicalManifest.format !== 1 ||
    logicalManifest.ref !== catalogSkill.ref ||
    logicalManifest.name !== catalogSkill.name ||
    logicalManifest.digest !== catalogSkill.digest ||
    logicalManifest.delivery !== 'native_project' ||
    JSON.stringify(logicalManifest.requiredToolRefs) !==
      JSON.stringify(catalogSkill.requiredToolRefs) ||
    logicalManifest.object !== `objects/${catalogSkill.digest}`
  )
    throw new Error('Skill logical manifest evidence mismatch.');
  if (
    !sameKeys(objectManifest, ['format', 'digest', 'files']) ||
    objectManifest.format !== 1 ||
    objectManifest.digest !== catalogSkill.digest ||
    !Array.isArray(objectManifest.files)
  )
    throw new Error('Skill object manifest evidence mismatch.');
  if (
    !sameKeys(receipt, ['format', 'ref', 'digest', 'delivery']) ||
    receipt.format !== 1 ||
    receipt.ref !== catalogSkill.ref ||
    receipt.digest !== catalogSkill.digest ||
    receipt.delivery !== 'native_project'
  )
    throw new Error('Skill receipt evidence mismatch.');
  const objectFiles = await collectObjectFiles(catalogSkill.objectPath);
  const expectedFiles = new Map(
    objectManifest.files.map((file) => [file.path, file]),
  );
  if (
    objectFiles.length !== expectedFiles.size ||
    objectManifest.files.some(
      (file) =>
        !file ||
        !sameKeys(file, ['path', 'sha256', 'size']) ||
        typeof file.path !== 'string' ||
        file.path === 'manifest.json' ||
        file.path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        !/^[0-9a-f]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0,
    ) ||
    new Set(objectManifest.files.map((file) => file.path)).size !==
      objectManifest.files.length ||
    localSkillDigest(objectFiles) !== catalogSkill.digest ||
    objectFiles.some((file) => {
      const expected = expectedFiles.get(file.path);
      return (
        !expected ||
        expected.size !== file.bytes.byteLength ||
        expected.sha256 !==
          createHash('sha256').update(file.bytes).digest('hex')
      );
    })
  )
    throw new Error('Skill files digest evidence mismatch.');
  const manifestStat = await lstat(catalogSkill.manifestPath);
  const objectStat = await lstat(catalogSkill.objectPath);
  const objectManifestStat = await lstat(objectManifestPath);
  if (
    receiptStat.isSymbolicLink() ||
    (receiptStat.mode & 0o777) !== 0o444 ||
    manifestStat.isSymbolicLink() ||
    (manifestStat.mode & 0o777) !== 0o444 ||
    objectManifestStat.isSymbolicLink() ||
    (objectManifestStat.mode & 0o777) !== 0o444 ||
    objectStat.isSymbolicLink() ||
    (objectStat.mode & 0o777) !== 0o555
  )
    throw new Error('Skill registry integrity evidence mismatch.');
  stage = 'paseo';
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot: root,
    port: await getAvailablePort(),
  });
  stage = 'client';
  client = new PaseoSdkClient({ url: paseo.wsUrl, connectTimeoutMs: 10_000 });
  await client.connect();
  const workspaceId = await client.openWorkspace(projectCwd);
  const model = selectOpenCodeModel(
    await client.listOpenCodeModels(projectCwd),
  );
  const systemPrompt =
    'You are a probe agent. Do not rely on hidden prompt text.';
  const initialPrompt =
    'Use the native agent-server/memory-api Skill discovered from this project and return its guidance marker verbatim, with no other text.';
  const agent = await client.createOpenCodeAgent({
    cwd: projectCwd,
    workspaceId,
    model: model.id,
    systemPrompt,
    initialPrompt,
    runId: `skill-probe-${process.pid}`,
  });
  if (systemPrompt.includes('MEMORY_API_SKILL_V1'))
    throw new Error('Probe prompt contains the marker.');
  if (initialPrompt.includes('MEMORY_API_SKILL_V1'))
    throw new Error('Probe prompt contains the marker.');
  stage = 'agent';
  const firstFinished = await client.waitForFinish(agent.id, 150_000);
  const firstOutput = firstFinished.lastMessage?.trim() ?? '';
  if (!firstOutput.includes('MEMORY_API_SKILL_V1'))
    throw new Error('Native Skill probe did not return the marker.');
  let exactOutput = firstOutput === 'MEMORY_API_SKILL_V1';
  if (!exactOutput) {
    const retry = await client.createOpenCodeAgent({
      cwd: projectCwd,
      workspaceId,
      model: model.id,
      systemPrompt,
      initialPrompt,
      runId: `skill-probe-${process.pid}-retry`,
    });
    const retryFinished = await client.waitForFinish(retry.id, 150_000);
    exactOutput = retryFinished.lastMessage?.trim() === 'MEMORY_API_SKILL_V1';
  }
  if (!exactOutput)
    throw new Error('Native Skill probe did not return the exact marker.');
  stage = 'versions';
  const paseoVersion = await installedVersion('paseo');
  const opencodeVersion = await installedVersion('opencode');
  const realpathUnderRegistry = linkRealPath.startsWith(
    `${await realpath(registryRoot)}/`,
  );
  const cleanup = await cleanupProbe();
  if (cleanup.failures.length || !cleanup.runtimeStateRemoved)
    throw new Error('skill_probe_cleanup_failed');
  process.stdout.write(
    `${JSON.stringify({ success: true, marker: 'MEMORY_API_SKILL_V1', digest: catalogSkill.digest, symlink: linkStat.isSymbolicLink(), realpath_under_registry: realpathUnderRegistry, logical_ref_valid: true, object_manifest_valid: true, receipt_valid: true, files_digest_valid: true, manifest_mode: manifestStat.mode & 0o777, object_mode: objectStat.mode & 0o777, receipt_mode: receiptStat.mode & 0o777, native_skill_evidence: 'marker returned by Agent with marker absent from systemPrompt and initialPrompt', exact_output: exactOutput, paseo_version: paseoVersion, opencode_version: opencodeVersion })}\n`,
  );
} catch (error) {
  const cleanup = await cleanupProbe();
  process.stderr.write(
    `${JSON.stringify({ success: false, stage, error_code: safeErrorCode(error), cleanup_failures: cleanup.failures, runtime_state_removed: cleanup.runtimeStateRemoved })}\n`,
  );
  process.exitCode = 1;
}

async function installedVersion(provider) {
  const binary =
    provider === 'paseo'
      ? await resolvePaseoBinary()
      : await resolveOpenCodeBinary();
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], {
      encoding: 'utf8',
    });
    const version = stdout.trim();
    if (!version) throw new Error(`${provider}_version_empty`);
    return version;
  } catch (error) {
    if (Number.isInteger(error?.code) && error.code !== 0) {
      const code = `${provider}_version_exit_${error.code}`;
      throw Object.assign(new Error(code), { code });
    }
    if (error?.signal) {
      const code = `${provider}_version_signal_${error.signal}`;
      throw Object.assign(new Error(code), { code });
    }
    throw error;
  }
}

function localSkillDigest(files) {
  const hash = createHash('sha256');
  hash.update(Buffer.from('agent-server-skill-package-v1\0', 'utf8'));
  for (const file of [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const path = Buffer.from(file.path, 'utf8');
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(path.byteLength), 0);
    hash.update(length);
    hash.update(path);
    length.writeBigUInt64BE(BigInt(file.bytes.byteLength), 0);
    hash.update(length);
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}

function safeErrorCode(error) {
  return error?.code && /^[A-Za-z0-9_.-]+$/.test(error.code)
    ? error.code
    : error?.name && /^[A-Za-z0-9_.-]+$/.test(error.name)
      ? error.name
      : 'smoke_failure';
}

async function cleanupProbe() {
  const failures = [];
  for (const [label, operation] of [
    ['client', () => client?.close()],
    ['paseo_process', () => stopProcessTree(paseo?.child)],
    ['runtime_root', () => removeRuntimeRoot(root)],
  ]) {
    try {
      await operation();
    } catch {
      failures.push(label);
    }
  }
  return { failures, runtimeStateRemoved: !(await exists(root)) };
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function sameKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

async function collectObjectFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink())
        throw new Error('Skill object contains symlink.');
      if (stat.isDirectory()) {
        if ((stat.mode & 0o777) !== 0o555)
          throw new Error('Skill object mode mismatch.');
        await visit(path);
      } else if (relative(root, path) !== 'manifest.json') {
        if (!stat.isFile() || (stat.mode & 0o777) !== 0o444)
          throw new Error('Skill object file mode mismatch.');
        files.push({
          path: relative(root, path).split(sep).join('/'),
          bytes: await readFile(path),
        });
      }
    }
  }
  await visit(root);
  return files;
}

async function makeRemovable(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await makeRemovable(path);
    else if (entry.isFile()) await chmod(path, 0o644);
  }
  await chmod(directory, 0o755).catch(() => undefined);
}

async function removeRuntimeRoot(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await makeRemovable(directory);
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error('Skill probe runtime cleanup did not converge.');
}
