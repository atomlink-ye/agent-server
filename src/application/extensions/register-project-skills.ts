import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseManagedAgentPackage } from '../../domain/agents/managed-agent-package.js';
import { registerSkill } from './skill-registry.js';

export type ProjectSkillRegistration = Readonly<{
  readonly ref: string;
  readonly digest: string;
  readonly changed: boolean;
}>;

export type ProjectSkillRegistrationErrorCode =
  | 'PROJECT_MISSING'
  | 'PROJECT_INVALID'
  | 'INVALID_AGENT_PACKAGE'
  | 'PROJECT_REF_MISMATCH'
  | 'MISSING_LOCAL_SKILL'
  | 'MISMATCHED_LOCAL_SKILL'
  | 'UNREFERENCED_LOCAL_SKILL'
  | 'REGISTRY_FAILURE';

export class ProjectSkillRegistrationError extends Error {
  public constructor(
    public readonly code: ProjectSkillRegistrationErrorCode,
    message: string,
    completed: readonly ProjectSkillRegistration[] = [],
  ) {
    super(message);
    this.name = 'ProjectSkillRegistrationError';
    this.completed = Object.freeze([...completed]);
  }

  public readonly completed: readonly ProjectSkillRegistration[];
}

export async function registerProjectSkills(input: {
  readonly projectRoot: string;
  readonly registryRoot: string;
}): Promise<readonly ProjectSkillRegistration[]> {
  const projectRoot = resolve(input.projectRoot);
  const projectStat = await safeLstat(projectRoot);
  if (!projectStat) throw projectMissing();
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink())
    throw projectInvalid();

  let parsed: ReturnType<typeof parseManagedAgentPackage>;
  try {
    parsed = parseManagedAgentPackage(await readAgentYaml(projectRoot));
  } catch {
    throw invalidAgentPackage();
  }

  const agentPrefix = `project/${parsed.normalizedName}/`;
  const localSkillsRoot = join(projectRoot, 'skills');
  const localDirectories =
    await enumerateLocalSkillDirectories(localSkillsRoot);
  const localNames = new Set(localDirectories.map(({ name }) => name));
  const declaredLocalRefs = new Map<string, string>();

  for (const skill of parsed.package.spec.skills) {
    if (skill.ref.startsWith('project/') && !skill.ref.startsWith(agentPrefix))
      throw projectRefMismatch();
    if (!skill.ref.startsWith(agentPrefix)) continue;
    const leaf = skill.ref.slice(agentPrefix.length);
    if (!leaf || leaf.includes('/')) throw mismatchedLocalSkill();
    if (declaredLocalRefs.has(leaf)) throw mismatchedLocalSkill();
    declaredLocalRefs.set(leaf, skill.ref);
  }

  for (const leaf of declaredLocalRefs.keys()) {
    if (!localNames.has(leaf)) throw missingLocalSkill();
  }
  for (const leaf of localNames) {
    if (!declaredLocalRefs.has(leaf)) throw unreferencedLocalSkill();
  }

  const results: ProjectSkillRegistration[] = [];
  try {
    for (const { name, path } of localDirectories) {
      const registered = await registerSkill({
        registryRoot: input.registryRoot,
        ref: declaredLocalRefs.get(name)!,
        name,
        sourceRoot: path,
        requiredToolRefs: [],
      });
      results.push(
        Object.freeze({
          ref: registered.ref,
          digest: registered.digest,
          changed: registered.changed,
        }),
      );
    }
  } catch {
    throw registryFailure(results);
  }
  return Object.freeze(results);
}

async function readAgentYaml(projectRoot: string): Promise<string> {
  const path = join(projectRoot, 'agent.yaml');
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile() || openedStat.isSymbolicLink())
        throw new Error();
      return (await handle.readFile()).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    throw new Error('Agent package is invalid.');
  }
}

async function enumerateLocalSkillDirectories(
  root: string,
): Promise<readonly { readonly name: string; readonly path: string }[]> {
  const rootStat = await safeLstat(root);
  if (!rootStat) return [];
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw projectInvalid();

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw projectInvalid();
  }
  const directories: { name: string; path: string }[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    const stat = await safeLstat(path);
    if (!stat || stat.isSymbolicLink()) throw projectInvalid();
    if (!stat.isDirectory()) throw projectInvalid();
    directories.push({ name: entry.name, path });
  }
  directories.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  return directories;
}

async function safeLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw projectInvalid();
  }
}

function projectMissing(): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'PROJECT_MISSING',
    'Project is missing.',
  );
}
function projectInvalid(): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'PROJECT_INVALID',
    'Project is invalid.',
  );
}
function invalidAgentPackage(): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'INVALID_AGENT_PACKAGE',
    'Agent package is invalid.',
  );
}
function projectRefMismatch(): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'PROJECT_REF_MISMATCH',
    'A project Skill reference belongs to another project.',
  );
}
function missingLocalSkill(): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'MISSING_LOCAL_SKILL',
    'A declared local Skill is missing.',
  );
}
function mismatchedLocalSkill(): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'MISMATCHED_LOCAL_SKILL',
    'A declared local Skill is mismatched.',
  );
}
function unreferencedLocalSkill(): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'UNREFERENCED_LOCAL_SKILL',
    'A local Skill is unreferenced.',
  );
}
function registryFailure(
  completed: readonly ProjectSkillRegistration[],
): ProjectSkillRegistrationError {
  return new ProjectSkillRegistrationError(
    'REGISTRY_FAILURE',
    'Skill Registry registration failed.',
    completed,
  );
}
