import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  open,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  AGENT_SERVER_MEMORY_API_SKILL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
} from '../agents/built-in-skills.js';
import type { ResolvedSkillPackage } from './skill-catalog.js';
import { digestSkillFiles } from './skill-package-digest.js';
import { validateSkillMetadata } from './skill-metadata.js';

export const MAX_SKILL_FILES = 64;
export const MAX_SKILL_TOTAL_BYTES = 1024 * 1024;
export const MAX_SKILL_FILE_BYTES = 256 * 1024;

export type SkillPackage = ResolvedSkillPackage;

export async function registerSkill(input: {
  readonly registryRoot: string;
  readonly ref: string;
  readonly name: string;
  readonly sourceRoot: string;
  readonly expectedDigest?: string;
  readonly requiredToolRefs: readonly string[];
}): Promise<Readonly<ResolvedSkillPackage & { changed: boolean }>> {
  try {
    validateMetadata(input.ref);
    validateSkillMetadata(input.name, input.requiredToolRefs);
    const sourceRoot = resolve(input.sourceRoot);
    const sourceStat = await lstat(sourceRoot);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink())
      throw new Error('Invalid Skill source root.');
    const sourceRealPath = await realpath(sourceRoot);
    const files = await enumerate(sourceRoot, sourceRealPath);
    const skillFile = files.find((file) => file.path === 'SKILL.md');
    if (!skillFile) throw new Error('Skill package is missing SKILL.md.');
    validateSkillFrontmatter(skillFile.bytes.toString('utf8'), input.name);

    const digest = digestSkillFiles(files);
    if (input.expectedDigest !== undefined && digest !== input.expectedDigest)
      throw new Error('Skill digest mismatch.');
    const registryRoot = resolve(input.registryRoot);
    const objectPath = join(registryRoot, 'objects', digest);
    const manifestPath =
      join(registryRoot, 'refs', ...input.ref.split('/')) + '.json';
    const manifest = {
      format: 1,
      digest,
      files: files.map(({ path, bytes }) => ({
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
      })),
    };
    const refManifest = {
      format: 1,
      ref: input.ref,
      name: input.name,
      digest,
      delivery: 'native_project' as const,
      requiredToolRefs: [...input.requiredToolRefs],
      object: `objects/${digest}`,
    };
    const manifestContent = `${JSON.stringify(manifest)}\n`;
    const refContent = `${JSON.stringify(refManifest)}\n`;

    await ensureDirectoryPath(registryRoot);
    await ensureDirectoryPath(join(registryRoot, 'objects'));
    await ensureDirectoryPath(dirname(manifestPath));
    const refPublished = await inspectManifest(manifestPath, refContent);
    await ensureObject(objectPath, files, manifest, refPublished);
    await ensureManifest(manifestPath, refContent, objectPath, files, manifest);
    return Object.freeze({
      ref: input.ref,
      name: input.name,
      digest,
      objectPath,
      manifestPath,
      delivery: 'native_project',
      requiredToolRefs: Object.freeze([...input.requiredToolRefs]),
      changed: !refPublished,
    });
  } catch (error) {
    if (isStableRegistrationError(error)) throw error;
    throw new Error('Skill registration failed.', { cause: error });
  }
}

export async function seedMemoryApiSkill(input: {
  readonly runtimeRoot: string;
  readonly repositoryRoot: string;
}): Promise<SkillPackage> {
  const repositoryRealPath = await realpath(resolve(input.repositoryRoot));
  const sourceRoot = resolve(
    input.repositoryRoot,
    'skills/agent-server-memory-api',
  );
  const sourceRealPath = await realpath(sourceRoot);
  if (!inside(repositoryRealPath, sourceRealPath))
    throw new Error('Skill source is outside the repository.');
  const result = await registerSkill({
    registryRoot: resolve(input.runtimeRoot, 'skill-registry'),
    ref: AGENT_SERVER_MEMORY_API_SKILL_REF,
    name: AGENT_SERVER_MEMORY_API_SKILL_REF,
    sourceRoot,
    requiredToolRefs: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
  });
  const { changed: _changed, ...skill } = result;
  return Object.freeze(skill);
}

function validateMetadata(ref: string): void {
  if (
    !ref ||
    ref.includes('\\') ||
    ref.includes('\0') ||
    ref.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid Skill ref.');
}

async function enumerate(
  root: string,
  rootRealPath: string,
): Promise<{ path: string; bytes: Buffer }[]> {
  const result: { path: string; bytes: Buffer }[] = [];
  let total = 0;
  async function visit(directory: string): Promise<void> {
    const directoryRealPath = await realpath(directory);
    if (!inside(rootRealPath, directoryRealPath))
      throw new Error('Skill source is outside the source root.');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    )) {
      if (entry.name.includes('\0'))
        throw new Error('Skill path contains NUL.');
      const absolute = join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink())
        throw new Error('Skill packages cannot contain symlinks.');
      if (stat.isDirectory()) await visit(absolute);
      else if (stat.isFile()) {
        if ((stat.mode & 0o111) !== 0)
          throw new Error('Skill packages cannot contain executable files.');
        const path = relative(root, absolute).split(sep).join('/');
        if (path.startsWith('/') || path.split('/').includes('..'))
          throw new Error('Invalid Skill path.');
        if (result.length >= MAX_SKILL_FILES)
          throw new Error('Skill package has too many files.');
        const parentRealPath = await realpath(dirname(absolute));
        if (!inside(rootRealPath, parentRealPath))
          throw new Error('Skill source is outside the source root.');
        const handle = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        let bytes: Buffer;
        try {
          const openedStat = await handle.stat();
          if (!openedStat.isFile() || (openedStat.mode & 0o111) !== 0)
            throw new Error('Skill packages cannot contain executable files.');
          if (
            openedStat.size > MAX_SKILL_FILE_BYTES ||
            total + openedStat.size > MAX_SKILL_TOTAL_BYTES
          )
            throw new Error('Skill package exceeds size limits.');
          total += openedStat.size;
          bytes = await handle.readFile();
          const finalStat = await handle.stat();
          if (
            bytes.byteLength !== openedStat.size ||
            finalStat.size !== openedStat.size
          )
            throw new Error('Skill changed while being read.');
        } finally {
          await handle.close();
        }
        result.push({ path, bytes });
      } else throw new Error('Skill package contains an unsupported file.');
    }
  }
  await visit(root);
  return result;
}

function validateSkillFrontmatter(source: string, expectedName: string): void {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('Skill frontmatter is invalid.');
  const frontmatter = match[1] ?? '';
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (name !== expectedName || !description)
    throw new Error('Skill frontmatter is invalid.');
}

async function ensureObject(
  objectPath: string,
  files: readonly { path: string; bytes: Buffer }[],
  manifest: object,
  refPublished: boolean,
): Promise<void> {
  let existingRoot: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    existingRoot = await lstat(objectPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    if (refPublished)
      throw new Error('Skill object is missing its published ref.');
  }
  if (existingRoot) {
    if (!existingRoot.isDirectory() || existingRoot.isSymbolicLink())
      throw new Error('Skill object mismatch.');
    const mode = existingRoot.mode & 0o777;
    if (mode !== 0o555 && !(mode === 0o755 && !refPublished))
      throw new Error('Skill object mismatch.');
    await verifyObject(objectPath, files, manifest, mode);
    if (mode === 0o755) {
      await chmod(objectPath, 0o555);
      await verifyObject(objectPath, files, manifest, 0o555);
    }
    return;
  }
  const stagingPath = join(
    dirname(objectPath),
    `.stage-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(stagingPath);
  try {
    for (const file of files) {
      const target = join(stagingPath, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes, { flag: 'wx', mode: 0o444 });
      await chmod(target, 0o444);
    }
    const objectManifestPath = join(stagingPath, 'manifest.json');
    await writeFile(objectManifestPath, `${JSON.stringify(manifest)}\n`, {
      flag: 'wx',
      mode: 0o444,
    });
    await chmod(objectManifestPath, 0o444);
    await makeReadOnly(stagingPath);
    await chmod(stagingPath, 0o555);
    await verifyObject(stagingPath, files, manifest, 0o555);
    try {
      try {
        await rename(stagingPath, objectPath);
      } catch (error) {
        // Darwin requires write permission on a directory being renamed.
        if ((error as NodeJS.ErrnoException)?.code !== 'EACCES') throw error;
        await chmod(stagingPath, 0o755);
        await rename(stagingPath, objectPath);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
      await verifyObject(objectPath, files, manifest, 0o555);
    }
  } finally {
    await removeTree(stagingPath);
  }
  await chmod(objectPath, 0o555);
  await verifyObject(objectPath, files, manifest, 0o555);
}

async function verifyObject(
  objectPath: string,
  files: readonly { path: string; bytes: Buffer }[],
  manifest: object,
  rootMode: number,
): Promise<void> {
  const rootStat = await lstat(objectPath);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o777) !== rootMode
  )
    throw new Error('Skill object mismatch.');
  const expected = new Map(files.map((file) => [file.path, file]));
  const actual = await enumerateObject(objectPath);
  if (
    actual.length !== expected.size ||
    actual.some((file) => !expected.has(file.path))
  )
    throw new Error('Skill object mismatch.');
  for (const file of files) {
    const found = actual.find((candidate) => candidate.path === file.path);
    if (!found || !found.bytes.equals(file.bytes))
      throw new Error('Skill object mismatch.');
  }
  const manifestPath = join(objectPath, 'manifest.json');
  const stat = await lstat(manifestPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o444 ||
    (await readImmutableFile(manifestPath)) !== `${JSON.stringify(manifest)}\n`
  )
    throw new Error('Skill object mismatch.');
}

async function enumerateObject(
  root: string,
): Promise<{ path: string; bytes: Buffer }[]> {
  const result: { path: string; bytes: Buffer }[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => compareCodeUnits(a.name, b.name))) {
      const absolute = join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error('Skill object mismatch.');
      if (stat.isDirectory()) {
        if ((stat.mode & 0o777) !== 0o555)
          throw new Error('Skill object mismatch.');
        await visit(absolute);
      } else if (relative(root, absolute) !== 'manifest.json') {
        if ((stat.mode & 0o777) !== 0o444)
          throw new Error('Skill object mismatch.');
        const handle = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const openedStat = await handle.stat();
          if (!openedStat.isFile() || (openedStat.mode & 0o111) !== 0)
            throw new Error('Skill object mismatch.');
          const bytes = await handle.readFile();
          const finalStat = await handle.stat();
          if (finalStat.size !== openedStat.size)
            throw new Error('Skill object mismatch.');
          result.push({
            path: relative(root, absolute).split(sep).join('/'),
            bytes,
          });
        } finally {
          await handle.close();
        }
      }
    }
  }
  await visit(root);
  return result;
}

async function ensureManifest(
  path: string,
  content: string,
  objectPath: string,
  files: readonly { path: string; bytes: Buffer }[],
  manifest: object,
): Promise<void> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o444
    )
      throw new Error('Skill ref mismatch.');
    if ((await readFile(path, 'utf8')) === content) {
      await verifyObject(objectPath, files, manifest, 0o555);
      return;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Skill ref mismatch.')
      throw error;
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  const temporary = join(
    dirname(path),
    `.ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o444 });
    await chmod(temporary, 0o444);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  await verifyObject(objectPath, files, manifest, 0o555);
}

async function inspectManifest(
  path: string,
  content: string,
): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o444
    )
      throw new Error('Skill ref mismatch.');
    return (await readFile(path, 'utf8')) === content;
  } catch (error) {
    if (error instanceof Error && error.message === 'Skill ref mismatch.')
      throw error;
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    return false;
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const STABLE_REGISTRATION_ERRORS = new Set([
  'Invalid Skill ref.',
  'Invalid Skill name.',
  'Invalid Skill tool reference.',
  'Invalid Skill source root.',
  'Skill package is missing SKILL.md.',
  'Skill packages cannot contain symlinks.',
  'Skill packages cannot contain executable files.',
  'Skill package contains an unsupported file.',
  'Skill path contains NUL.',
  'Invalid Skill path.',
  'Skill package has too many files.',
  'Skill package exceeds size limits.',
  'Skill changed while being read.',
  'Skill source is outside the source root.',
  'Skill digest mismatch.',
  'Skill frontmatter is invalid.',
  'Skill object is missing its published ref.',
  'Skill object mismatch.',
  'Skill ref mismatch.',
  'Unsafe Registry path.',
]);

function isStableRegistrationError(error: unknown): boolean {
  return (
    error instanceof Error && STABLE_REGISTRATION_ERRORS.has(error.message)
  );
}

async function makeReadOnly(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isDirectory()) {
    for (const entry of await readdir(path))
      await makeReadOnly(join(path, entry));
    await chmod(path, 0o555);
  } else await chmod(path, 0o444);
}

async function removeTree(path: string): Promise<void> {
  try {
    await chmod(path, 0o755);
  } catch {
    /* already gone */
  }
  await rm(path, { recursive: true, force: true });
}

async function readImmutableFile(path: string): Promise<string> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o444)
        throw new Error('Skill object mismatch.');
      return (await handle.readFile()).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Skill object mismatch.')
      throw error;
    throw new Error('Skill object mismatch.');
  }
}

async function ensureDirectoryPath(path: string): Promise<void> {
  let current = '/';
  for (const part of relative('/', resolve(path)).split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Unsafe Registry path.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      await mkdir(current);
    }
  }
}

export function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
