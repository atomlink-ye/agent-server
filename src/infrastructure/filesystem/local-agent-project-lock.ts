import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AgentProjectLock } from '../../domain/projects/agent-project-lock.js';
import type { AgentProjectLockStore } from '../../application/ports/agent-project-lock-store.js';
import { normalizeMemoryPath } from '../../domain/memory-api/memory-api.js';

export class LocalAgentProjectLock implements AgentProjectLockStore {
  private readonly path: string;
  public constructor(projectDirectory: string) {
    this.path = join(resolve(projectDirectory), 'agent-project.lock.json');
  }
  public async read(): Promise<AgentProjectLock | null> {
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('lock_invalid');
      const handle = await open(
        this.path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        return parseLock((await handle.readFile()).toString('utf8'));
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof Error && error.message === 'lock_invalid')
        throw error;
      throw new Error('lock_invalid');
    }
  }
  public async write(
    lock: AgentProjectLock,
  ): Promise<{ outcome: 'Create' | 'Update' | 'NoOp'; fingerprint: string }> {
    const directory = dirname(this.path);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('lock_directory_invalid');
    const target = await lstat(this.path).catch(() => null);
    if (target?.isSymbolicLink()) throw new Error('lock_invalid');
    const content = `${JSON.stringify(sortValue(lock), null, 2)}\n`;
    const fingerprint = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    const existing = await readFileIfRegular(this.path);
    if (existing === content) return { outcome: 'NoOp', fingerprint };
    const temporary = join(
      directory,
      `.agent-project.lock.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
    return { outcome: existing === null ? 'Create' : 'Update', fingerprint };
  }
}

async function readFileIfRegular(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('lock_invalid');
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof Error && error.message === 'lock_invalid') throw error;
    throw new Error('lock_invalid');
  }
}

function parseLock(source: string): AgentProjectLock {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('lock_invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('lock_invalid');
  const lock = value as Record<string, unknown>;
  if (
    lock.apiVersion !== 'agent-server/v1alpha1' ||
    lock.kind !== 'AgentProjectLock'
  )
    throw new Error('lock_invalid');
  exact(lock, [
    'apiVersion',
    'kind',
    'project',
    'workspace',
    'toolProfiles',
    'skills',
    'environments',
    'workers',
    'teams',
    'memoryStores',
    'entrypoints',
  ]);
  exact(object(lock.project), ['name', 'fingerprint']);
  exact(object(lock.workspace), ['ref', 'id', 'name']);
  for (const item of array(lock.toolProfiles))
    exact(object(item), ['ref', 'sourceFingerprint', 'tools']);
  for (const item of array(lock.skills))
    exact(object(item), ['ref', 'catalogRef', 'digest', 'requiredTools']);
  for (const section of ['environments', 'workers', 'teams'])
    for (const item of array(lock[section]))
      exact(object(item), [
        'ref',
        'sourceFingerprint',
        'appliedFingerprint',
        'definitionId',
        'versionId',
      ]);
  for (const item of array(lock.memoryStores)) {
    exact(object(item), ['ref', 'id', 'name', 'seeds']);
    for (const seed of array(object(item).seeds))
      exact(object(seed), [
        'path',
        'contentSha256',
        'memoryId',
        'memoryVersionId',
      ]);
  }
  for (const item of array(lock.entrypoints))
    exact(object(item), ['ref', 'teamVersionId']);
  validateLock(lock);
  if (`${JSON.stringify(sortValue(lock), null, 2)}\n` !== source)
    throw new Error('lock_invalid');
  return value as AgentProjectLock;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('lock_invalid');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('lock_invalid');
  return value;
}
function exact(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error('lock_invalid');
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          sortValue((value as Record<string, unknown>)[key]),
        ]),
    );
  return value;
}

function validateLock(lock: Record<string, unknown>): void {
  const project = object(lock.project),
    workspace = object(lock.workspace);
  kebab(project.name);
  fingerprint(project.fingerprint);
  if (workspace.ref !== 'workspace://default') invalid();
  uuid(workspace.id);
  displayString(workspace.name);
  for (const item of array(lock.toolProfiles)) {
    const x = object(item);
    logical(x.ref, 'tool-profile');
    fingerprint(x.sourceFingerprint);
    sortedStrings(x.tools);
    unique(x.tools);
  }
  sortedBy(array(lock.toolProfiles), 'ref');
  for (const item of array(lock.skills)) {
    const x = object(item);
    logical(x.ref, 'skill');
    bareDigest(x.digest);
    const projectName = string(project.name);
    if (
      x.catalogRef !==
      `project/${projectName}/${string(x.ref).slice('skill://'.length)}`
    )
      invalid();
    sortedStrings(x.requiredTools);
    unique(x.requiredTools);
  }
  sortedBy(array(lock.skills), 'ref');
  unique(array(lock.skills).map((x) => string(object(x).ref)));
  for (const section of ['environments', 'workers', 'teams'] as const)
    sortedBy(array(lock[section]), 'ref');
  for (const section of ['environments', 'workers', 'teams'] as const)
    for (const item of array(lock[section])) {
      const x = object(item);
      logical(
        x.ref,
        section === 'environments'
          ? 'environment'
          : section === 'workers'
            ? 'worker'
            : 'team',
      );
      fingerprint(x.sourceFingerprint);
      fingerprint(x.appliedFingerprint);
      uuid(x.definitionId);
      uuid(x.versionId);
    }
  unique(array(lock.environments).map((x) => string(object(x).ref)));
  unique(array(lock.workers).map((x) => string(object(x).ref)));
  unique(array(lock.teams).map((x) => string(object(x).ref)));
  sortedBy(array(lock.memoryStores), 'ref');
  for (const item of array(lock.memoryStores)) {
    const x = object(item);
    logical(x.ref, 'memory');
    uuid(x.id);
    displayString(x.name);
    const seeds = array(x.seeds);
    sortedBy(seeds, 'path');
    for (const seed of seeds) {
      const s = object(seed);
      if (normalizeMemoryPath(string(s.path)) !== s.path) invalid();
      bareDigest(s.contentSha256);
      uuid(s.memoryId);
      uuid(s.memoryVersionId);
    }
  }
  const teams = array(lock.teams),
    entries = array(lock.entrypoints);
  sortedBy(entries, 'ref');
  for (const item of entries) {
    const x = object(item);
    logical(x.ref, 'team');
    uuid(x.teamVersionId);
    const team = teams.find((candidate) => object(candidate).ref === x.ref);
    if (!team || object(team).versionId !== x.teamVersionId) invalid();
  }
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) invalid();
  return value;
}
function kebab(value: unknown): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(string(value))) invalid();
}
function displayString(value: unknown): void {
  const result = string(value);
  if (result.length > 255 || Buffer.byteLength(result, 'utf8') > 255) invalid();
}
function logical(value: unknown, kind: string): void {
  if (!new RegExp(`^${kind}://[a-z0-9]+(?:-[a-z0-9]+)*$`).test(string(value)))
    invalid();
}
function uuid(value: unknown): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      string(value),
    )
  )
    invalid();
}
function fingerprint(value: unknown): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(string(value))) invalid();
}
function bareDigest(value: unknown): void {
  if (!/^[0-9a-f]{64}$/.test(string(value))) invalid();
}
function sortedStrings(value: unknown): void {
  const xs = array(value).map(string);
  if (xs.some((x, i) => i > 0 && xs[i - 1]! >= x)) invalid();
}
function unique(value: unknown): void {
  const xs = array(value).map(string);
  if (new Set(xs).size !== xs.length) invalid();
}
function sortedBy(value: unknown[], key: string): void {
  if (
    value.some(
      (x, i) =>
        i > 0 && string(object(value[i - 1])[key]) >= string(object(x)[key]),
    )
  )
    invalid();
}
function invalid(): never {
  throw new Error('lock_invalid');
}
