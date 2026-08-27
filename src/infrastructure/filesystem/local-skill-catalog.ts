import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';

import type {
  ResolvedSkillPackage,
  SkillCatalogPort,
} from '../../application/extensions/skill-catalog.js';
import { digestSkillFiles } from '../../application/extensions/skill-package-digest.js';
import { validateSkillMetadata } from '../../application/extensions/skill-metadata.js';

export class LocalSkillCatalog implements SkillCatalogPort {
  public constructor(private readonly registryRoot: string) {}

  public async resolve(ref: string): Promise<ResolvedSkillPackage | null> {
    try {
      return await this.resolveInternal(ref);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Invalid Skill ref.' ||
          error.message === 'Skill catalog data is malformed.')
      )
        throw error;
      throw malformed();
    }
  }

  public async list(): Promise<readonly ResolvedSkillPackage[]> {
    try {
      return await this.listInternal();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Invalid Skill ref.' ||
          error.message === 'Skill catalog data is malformed.')
      )
        throw error;
      throw malformed();
    }
  }

  private async listInternal(): Promise<readonly ResolvedSkillPackage[]> {
    const refsRoot = resolve(this.registryRoot, 'refs');
    let refsStat;
    try {
      refsStat = await lstat(refsRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw malformed();
    }
    if (!refsStat.isDirectory() || refsStat.isSymbolicLink()) throw malformed();
    const refs = (await enumerateRefs(refsRoot, refsRoot)).sort(
      compareCodeUnits,
    );
    const packages: ResolvedSkillPackage[] = [];
    for (const ref of refs) {
      // Reuse `resolve()`'s exact hardening (symlink/mode/digest checks and
      // malformed-data surfacing) for every listed ref, rather than
      // re-deriving a parallel, and potentially weaker, set of checks here.
      const resolved = await this.resolveInternal(ref);
      if (!resolved) throw malformed();
      packages.push(resolved);
    }
    return Object.freeze(packages);
  }

  private async resolveInternal(
    ref: string,
  ): Promise<ResolvedSkillPackage | null> {
    if (!validRef(ref)) throw new Error('Invalid Skill ref.');
    const root = resolve(this.registryRoot);
    const refsRoot = resolve(root, 'refs');
    const manifestPath = join(refsRoot, ...ref.split('/')) + '.json';
    let content: string;
    try {
      const refsStat = await lstat(refsRoot);
      if (!refsStat.isDirectory() || refsStat.isSymbolicLink())
        throw malformed();
      const refsReal = await realpath(refsRoot);
      let currentRefPath = refsRoot;
      const refParts = ref.split('/');
      for (const [index, part] of refParts.entries()) {
        currentRefPath = join(
          currentRefPath,
          index === refParts.length - 1 ? `${part}.json` : part,
        );
        const partStat = await lstat(currentRefPath);
        if (partStat.isSymbolicLink()) throw malformed();
        if (index < refParts.length - 1 && !partStat.isDirectory())
          throw malformed();
      }
      const stat = await lstat(manifestPath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o777) !== 0o444
      )
        throw malformed();
      const manifestReal = await realpath(manifestPath);
      if (!inside(refsReal, manifestReal)) throw malformed();
      content = await readFile(manifestPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw malformed();
    }
    const manifest = parseRefManifest(content, ref);
    const objectPath = join(root, manifest.object);
    const objectsRoot = resolve(root, 'objects');
    let objectsReal: string;
    let objectReal: string;
    try {
      const objectsStat = await lstat(objectsRoot);
      if (!objectsStat.isDirectory() || objectsStat.isSymbolicLink())
        throw malformed();
      const objectPathStat = await lstat(objectPath);
      if (!objectPathStat.isDirectory() || objectPathStat.isSymbolicLink())
        throw malformed();
      objectsReal = await realpath(objectsRoot);
      objectReal = await realpath(objectPath);
    } catch {
      throw malformed();
    }
    if (
      !inside(objectsReal, objectReal) ||
      basename(objectReal) !== manifest.digest
    )
      throw malformed();
    let objectManifest: ObjectManifest;
    try {
      const objectStat = await lstat(objectReal);
      if (
        !objectStat.isDirectory() ||
        objectStat.isSymbolicLink() ||
        (objectStat.mode & 0o777) !== 0o555
      )
        throw malformed();
      const objectManifestPath = join(objectReal, 'manifest.json');
      const objectManifestReal = await realpath(objectManifestPath);
      if (!inside(objectReal, objectManifestReal)) throw malformed();
      const objectManifestStat = await lstat(objectManifestPath);
      if (
        !objectManifestStat.isFile() ||
        objectManifestStat.isSymbolicLink() ||
        (objectManifestStat.mode & 0o777) !== 0o444
      )
        throw malformed();
      objectManifest = await readObjectManifest(objectReal);
      if (objectManifest.digest !== manifest.digest) throw malformed();
    } catch {
      throw malformed();
    }
    await verifyObject(objectReal, objectManifest);
    return Object.freeze({
      ref: manifest.ref,
      name: manifest.name,
      digest: manifest.digest,
      objectPath: objectReal,
      manifestPath: resolve(manifestPath),
      delivery: manifest.delivery,
      requiredToolRefs: Object.freeze([...manifest.requiredToolRefs]),
    });
  }
}

type RefManifest = {
  format: 1;
  ref: string;
  name: string;
  digest: string;
  delivery: 'native_project';
  requiredToolRefs: string[];
  object: string;
};
type ObjectManifest = {
  format: 1;
  digest: string;
  files: { path: string; sha256: string; size: number }[];
};

function parseRefManifest(content: string, ref: string): RefManifest {
  try {
    const value = JSON.parse(content) as Partial<RefManifest>;
    if (
      Object.keys(value).some(
        (key) =>
          ![
            'format',
            'ref',
            'name',
            'digest',
            'delivery',
            'requiredToolRefs',
            'object',
          ].includes(key),
      ) ||
      value.format !== 1 ||
      value.ref !== ref ||
      typeof value.name !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.digest ?? '') ||
      value.delivery !== 'native_project' ||
      !Array.isArray(value.requiredToolRefs) ||
      value.requiredToolRefs.some((item) => typeof item !== 'string') ||
      value.object !== `objects/${value.digest}`
    )
      throw new Error();
    validateSkillMetadata(value.name, value.requiredToolRefs);
    return value as RefManifest;
  } catch {
    throw malformed();
  }
}

async function readObjectManifest(objectPath: string): Promise<ObjectManifest> {
  const objectManifestPath = join(objectPath, 'manifest.json');
  let objectManifest: string;
  const handle = await open(
    objectManifestPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o444) throw malformed();
    objectManifest = (await handle.readFile()).toString('utf8');
  } finally {
    await handle.close();
  }
  try {
    const parsed = JSON.parse(objectManifest) as ObjectManifest;
    if (
      parsed.format !== 1 ||
      !/^[a-f0-9]{64}$/.test(parsed.digest) ||
      !Array.isArray(parsed.files) ||
      Object.keys(parsed).some(
        (key) => !['format', 'digest', 'files'].includes(key),
      )
    )
      throw new Error();
    if (
      parsed.files.some(
        (file) =>
          !file ||
          typeof file.path !== 'string' ||
          !/^[a-f0-9]{64}$/.test(file.sha256) ||
          !Number.isSafeInteger(file.size) ||
          file.size < 0,
      )
    )
      throw new Error();
    return parsed;
  } catch {
    throw malformed();
  }
}

async function verifyObject(
  objectPath: string,
  manifest: ObjectManifest,
): Promise<void> {
  const files = await enumerate(objectPath, objectPath);
  if (files.length !== manifest.files.length) throw malformed();
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of files.sort((a, b) => compareCodeUnits(a.path, b.path))) {
    const expectedFile = expected.get(file.path);
    if (
      !expectedFile ||
      expectedFile.size !== file.bytes.byteLength ||
      expectedFile.sha256 !==
        createHash('sha256').update(file.bytes).digest('hex')
    )
      throw malformed();
  }
  if (digestSkillFiles(files) !== manifest.digest) throw malformed();
}

async function enumerate(
  root: string,
  rootRealPath: string,
): Promise<{ path: string; bytes: Buffer }[]> {
  const result: { path: string; bytes: Buffer }[] = [];
  async function visit(directory: string): Promise<void> {
    const directoryRealPath = await realpath(directory);
    if (!inside(rootRealPath, directoryRealPath)) throw malformed();
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => compareCodeUnits(a.name, b.name))) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw malformed();
      if (stat.isDirectory()) {
        if ((stat.mode & 0o777) !== 0o555) throw malformed();
        await visit(path);
      } else if (relative(root, path) !== 'manifest.json') {
        if ((stat.mode & 0o777) !== 0o444) throw malformed();
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const openedStat = await handle.stat();
          if (!openedStat.isFile() || (openedStat.mode & 0o111) !== 0)
            throw malformed();
          const bytes = await handle.readFile();
          const finalStat = await handle.stat();
          if (finalStat.size !== openedStat.size) throw malformed();
          result.push({
            path: relative(root, path).split(sep).join('/'),
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

/**
 * Walks the `refs/` tree and returns every ref it finds (path minus the
 * `.json` suffix), without following symlinks. It intentionally does not
 * validate manifest contents, digests, or object trees -- that hardening
 * belongs to `resolveInternal` alone, and every ref discovered here is
 * re-resolved through it so the two paths cannot drift apart.
 */
async function enumerateRefs(
  directory: string,
  refsRoot: string,
): Promise<string[]> {
  const refs: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => compareCodeUnits(a.name, b.name),
  )) {
    const entryPath = join(directory, entry.name);
    const stat = await lstat(entryPath);
    if (stat.isSymbolicLink()) throw malformed();
    if (stat.isDirectory()) {
      refs.push(...(await enumerateRefs(entryPath, refsRoot)));
    } else if (stat.isFile()) {
      if (!entry.name.endsWith('.json')) throw malformed();
      const ref = relative(refsRoot, entryPath).split(sep).join('/');
      refs.push(ref.slice(0, -'.json'.length));
    } else throw malformed();
  }
  return refs;
}

function validRef(ref: string): boolean {
  return (
    Boolean(ref) &&
    !ref.includes('\\') &&
    !ref.includes('\0') &&
    ref.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !path.startsWith(sep));
}
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function malformed(): Error {
  return new Error('Skill catalog data is malformed.');
}
