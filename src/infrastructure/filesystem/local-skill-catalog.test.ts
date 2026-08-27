import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { registerSkill } from '../../application/extensions/skill-registry.js';
import { LocalSkillCatalog } from './local-skill-catalog.js';

describe('LocalSkillCatalog.list', () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      // registerSkill() leaves the registry read-only by design; make it
      // writable again before removing the temp directory tree.
      await makeRemovable(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  async function tempDir(prefix: string): Promise<string> {
    const root = await mkdtemp(join(await realpath(tmpdir()), prefix));
    roots.push(root);
    return root;
  }

  it('lists every registered Skill through the same hardening resolve() applies', async () => {
    const registryRoot = await tempDir('agent-server-skill-registry-');
    const sourceRoot = await tempDir('agent-server-skill-source-');
    await writeFile(
      join(sourceRoot, 'SKILL.md'),
      '---\nname: test/example-skill\ndescription: A minimal test skill.\n---\nBody.\n',
    );
    await registerSkill({
      registryRoot,
      ref: 'test/example-skill',
      name: 'test/example-skill',
      sourceRoot,
      requiredToolRefs: ['agent-server/memory-read'],
    });

    const catalog = new LocalSkillCatalog(registryRoot);
    const skills = await catalog.list();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      ref: 'test/example-skill',
      name: 'test/example-skill',
      requiredToolRefs: ['agent-server/memory-read'],
    });
  });

  it('ignores a leftover registration staging file instead of failing the catalog', async () => {
    // registerSkill() stages its atomic rename as `.ref-<time>-<rand>` INSIDE
    // refs/<namespace>/. If enumeration treated an unrecognised entry as
    // corruption, every concurrent registration would 500 the whole catalog,
    // and a registration killed mid-write would brick Skill selection until
    // someone deleted the file by hand.
    const registryRoot = await tempDir('agent-server-skill-registry-');
    const sourceRoot = await tempDir('agent-server-skill-source-');
    await writeFile(
      join(sourceRoot, 'SKILL.md'),
      '---\nname: test/example-skill\ndescription: A minimal test skill.\n---\nBody.\n',
    );
    await registerSkill({
      registryRoot,
      ref: 'test/example-skill',
      name: 'test/example-skill',
      sourceRoot,
      requiredToolRefs: ['agent-server/memory-read'],
    });
    const namespace = join(registryRoot, 'refs', 'test');
    await chmod(namespace, 0o755);
    await writeFile(join(namespace, '.ref-1787000000000-abc123'), '{}');

    const skills = await new LocalSkillCatalog(registryRoot).list();

    expect(skills.map((skill) => skill.ref)).toEqual(['test/example-skill']);
  });

  it('still reports a malformed catalog for an entry that is not a staging file', async () => {
    // Skipping the known `.ref-<time>-<rand>` staging name must not become a
    // blanket "ignore anything unrecognised" rule: real corruption has to stay
    // loud.
    const registryRoot = await tempDir('agent-server-skill-registry-');
    const sourceRoot = await tempDir('agent-server-skill-source-');
    await writeFile(
      join(sourceRoot, 'SKILL.md'),
      '---\nname: test/example-skill\ndescription: A minimal test skill.\n---\nBody.\n',
    );
    await registerSkill({
      registryRoot,
      ref: 'test/example-skill',
      name: 'test/example-skill',
      sourceRoot,
      requiredToolRefs: ['agent-server/memory-read'],
    });
    const namespace = join(registryRoot, 'refs', 'test');
    await chmod(namespace, 0o755);
    await writeFile(join(namespace, 'unexpected.txt'), 'not a ref');

    await expect(new LocalSkillCatalog(registryRoot).list()).rejects.toThrow(
      /malformed/i,
    );
  });

  it('returns an empty catalog when the refs/ tree is absent', async () => {
    const registryRoot = await tempDir('agent-server-skill-registry-');

    const catalog = new LocalSkillCatalog(registryRoot);

    await expect(catalog.list()).resolves.toEqual([]);
  });

  it('rejects a symlinked ref rather than following it', async () => {
    const registryRoot = await tempDir('agent-server-skill-registry-');
    const outside = await tempDir('agent-server-skill-outside-');
    await writeFile(join(outside, 'escaped.json'), '{}');
    await mkdir(join(registryRoot, 'refs'), { recursive: true });
    await symlink(
      join(outside, 'escaped.json'),
      join(registryRoot, 'refs', 'escaped.json'),
    );

    const catalog = new LocalSkillCatalog(registryRoot);

    await expect(catalog.list()).rejects.toThrow(
      'Skill catalog data is malformed.',
    );
  });
});

async function makeRemovable(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => undefined);
  let entries: string[];
  try {
    entries = await readdir(path);
  } catch {
    return;
  }
  for (const entry of entries) await makeRemovable(join(path, entry));
}
