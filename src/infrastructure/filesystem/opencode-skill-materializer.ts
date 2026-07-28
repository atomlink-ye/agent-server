import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  readlink,
  chmod,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ResolvedSkillPackage } from '../../application/extensions/skill-catalog.js';
import { digestSkillFiles } from '../../application/extensions/skill-package-digest.js';

export async function materializeOpenCodeSkill(input: {
  readonly projectCwd: string;
  readonly runtimeRoot: string;
  readonly registryRoot: string;
  readonly skill: ResolvedSkillPackage;
}): Promise<{ readonly target: string; readonly receiptPath: string }> {
  const cwd = resolve(input.projectCwd);
  const runtimeRoot = resolve(input.runtimeRoot);
  const registryRoot = resolve(input.registryRoot);
  await validateDirectoryPath(cwd, 'project cwd');
  await validateDirectoryPath(runtimeRoot, 'runtime root');
  await validateDirectoryPath(registryRoot, 'Registry root');
  const cwdReal = await realpath(cwd);
  const runtimeReal = await realpath(runtimeRoot);
  const registryReal = await realpath(registryRoot);

  validateRef(input.skill.ref);
  if (!/^[0-9a-f]{64}$/.test(input.skill.digest))
    throw new Error('Invalid Skill digest.');
  if (input.skill.delivery !== 'native_project')
    throw new Error('Unsupported Skill delivery.');

  const manifestPath =
    join(registryReal, 'refs', ...input.skill.ref.split('/')) + '.json';
  const objectPath = join(registryReal, 'objects', input.skill.digest);
  if (resolve(input.skill.manifestPath) !== manifestPath)
    throw new Error('Skill manifest path is not canonical.');
  if (resolve(input.skill.objectPath) !== objectPath)
    throw new Error('Skill object path is not canonical.');
  if (!inside(registryReal, manifestPath) || !inside(registryReal, objectPath))
    throw new Error('Skill Registry path escapes its root.');
  const manifestReal = await realpath(manifestPath);
  if (manifestReal !== manifestPath || !inside(registryReal, manifestReal))
    throw new Error('Skill manifest is outside the Registry.');

  const logical = await readLogicalManifest(manifestPath, input.skill);
  if (logical.digest !== input.skill.digest)
    throw new Error('Skill digest does not match its logical ref.');
  const objectReal = await realpath(objectPath);
  if (objectReal !== objectPath || !inside(registryReal, objectReal))
    throw new Error('Skill object is outside the Registry.');
  await validateObject(objectReal, input.skill.digest);

  const target = join(
    cwdReal,
    '.agents',
    'skills',
    ...input.skill.ref.split('/'),
  );
  if (!inside(cwdReal, target))
    throw new Error('Skill project path escapes cwd.');
  await ensureSafeParents(cwdReal, dirname(target));
  try {
    await symlink(objectReal, target, 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
    const stat = await lstat(target);
    if (!stat.isSymbolicLink() || (await readlink(target)) !== objectReal)
      throw new Error('Existing Skill path does not match.');
  }

  const receiptName = `${input.skill.digest}-${createHash('sha256')
    .update(input.skill.ref)
    .digest('hex')}.json`;
  const receiptPath = join(runtimeReal, 'skill-receipts', receiptName);
  await ensureSafeParents(runtimeReal, dirname(receiptPath));
  const receipt = {
    format: 1,
    ref: input.skill.ref,
    digest: input.skill.digest,
    delivery: input.skill.delivery,
  };
  try {
    const stat = await lstat(receiptPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o444
    )
      throw new Error('Existing Skill receipt is unsafe.');
    if (
      (await readFile(receiptPath, 'utf8')) !== `${JSON.stringify(receipt)}\n`
    )
      throw new Error('Skill receipt mismatch.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    try {
      await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, {
        flag: 'wx',
        mode: 0o444,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      await validateReceipt(receiptPath, receipt);
    }
    await chmod(receiptPath, 0o444);
    await validateReceipt(receiptPath, receipt);
  }
  return { target, receiptPath };
}

function validateRef(ref: string): void {
  if (
    !ref ||
    ref.includes('\\') ||
    ref.includes('\0') ||
    isAbsolute(ref) ||
    ref.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid Skill ref.');
}

async function readLogicalManifest(
  path: string,
  skill: ResolvedSkillPackage,
): Promise<{ readonly digest: string }> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o444)
    throw new Error('Skill logical ref is unsafe.');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Skill logical ref is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    !value ||
    record.format !== 1 ||
    record.ref !== skill.ref ||
    record.name !== skill.name ||
    record.digest !== skill.digest ||
    record.delivery !== skill.delivery ||
    record.object !== `objects/${skill.digest}` ||
    !Array.isArray(record.requiredToolRefs) ||
    record.requiredToolRefs.some((ref) => typeof ref !== 'string') ||
    JSON.stringify(record.requiredToolRefs) !==
      JSON.stringify(skill.requiredToolRefs)
  )
    throw new Error('Skill logical ref is invalid.');
  return { digest: skill.digest };
}

async function validateObject(
  objectPath: string,
  digest: string,
): Promise<void> {
  const rootStat = await lstat(objectPath);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o777) !== 0o555
  )
    throw new Error('Skill object permissions are unsafe.');
  const manifestPath = join(objectPath, 'manifest.json');
  const manifestStat = await lstat(manifestPath);
  if (
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    (manifestStat.mode & 0o777) !== 0o444
  )
    throw new Error('Skill manifest is unsafe.');
  let manifest: {
    format: number;
    digest: string;
    files: { path: string; sha256: string; size: number }[];
  };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error('Skill manifest is invalid.');
  }
  if (
    manifest.format !== 1 ||
    manifest.digest !== digest ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Skill manifest is invalid.');
  const expected = new Map<string, { sha256: string; size: number }>();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      isAbsolute(file.path) ||
      file.path
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    )
      throw new Error('Skill manifest is invalid.');
    if (expected.has(file.path)) throw new Error('Skill manifest is invalid.');
    expected.set(file.path, { sha256: file.sha256, size: file.size });
  }
  const actual: { path: string; bytes: Buffer }[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error('Skill object is unsafe.');
      if (stat.isDirectory()) {
        if ((stat.mode & 0o777) !== 0o555)
          throw new Error('Skill object permissions are unsafe.');
        await visit(path);
      } else if (path !== manifestPath) {
        if ((stat.mode & 0o777) !== 0o444)
          throw new Error('Skill object permissions are unsafe.');
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          actual.push({
            path: relative(objectPath, path).split(sep).join('/'),
            bytes: await handle.readFile(),
          });
        } finally {
          await handle.close();
        }
      }
    }
  }
  await visit(objectPath);
  if (actual.length !== expected.size || digestSkillFiles(actual) !== digest)
    throw new Error('Skill object does not match its manifest.');
  for (const file of actual) {
    const expectedFile = expected.get(file.path);
    if (
      !expectedFile ||
      expectedFile.size !== file.bytes.byteLength ||
      expectedFile.sha256 !==
        createHash('sha256').update(file.bytes).digest('hex')
    )
      throw new Error('Skill object does not match its manifest.');
  }
}

async function validateDirectoryPath(
  path: string,
  label: string,
): Promise<void> {
  let current: string = sep;
  for (const part of relative(sep, resolve(path)).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Unsafe ${label} path.`);
  }
}

async function ensureSafeParents(
  root: string,
  directory: string,
): Promise<void> {
  let current = root;
  for (const part of relative(root, directory).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Refusing to follow an unmanaged project path.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
        const concurrent = await lstat(current);
        if (!concurrent.isDirectory() || concurrent.isSymbolicLink())
          throw new Error('Refusing to follow an unmanaged project path.');
      }
    }
  }
}

async function validateReceipt(
  path: string,
  receipt: Readonly<Record<string, unknown>>,
): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o444)
    throw new Error('Existing Skill receipt is unsafe.');
  if ((await readFile(path, 'utf8')) !== `${JSON.stringify(receipt)}\n`)
    throw new Error('Skill receipt mismatch.');
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
