import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import {
  parseManagedAgentYaml,
  ManagedAgentYamlError,
  MAX_COLLECTION_SIZE,
  MAX_SCALAR_LENGTH,
} from '../../domain/agents/managed-agent-yaml.js';
import { parseManagedAgentPackage } from '../../domain/agents/managed-agent-package.js';
import { parseManagedEnvironmentPackage } from '../../domain/environments/managed-environment-package.js';
import { digestSkillFiles } from '../../application/extensions/skill-package-digest.js';
import {
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_FILES,
  MAX_SKILL_TOTAL_BYTES,
} from '../../application/extensions/skill-registry.js';
import { normalizeMemoryPath } from '../../domain/memory-api/memory-api.js';
import type {
  AgentProjectManifest,
  NormalizedAgentProject,
  SourceTuple,
} from '../../domain/projects/agent-project.js';
import {
  logicalRef,
  parseLogicalRef,
} from '../../domain/projects/logical-ref.js';
import {
  canonicalizeManifest,
  fingerprintProject,
} from '../../domain/projects/project-canonicalization.js';
import type {
  LocalToolProfile,
  NormalizedLocalToolProfile,
} from '../../domain/projects/local-tool-profile.js';
import { isSafeNativeRef } from '../../domain/projects/safe-ref.js';

export class LocalAgentProjectLoaderError extends Error {
  public constructor(
    readonly code: string,
    readonly path = '$',
  ) {
    super(code);
    this.name = 'LocalAgentProjectLoaderError';
  }
}

type RecordValue = Record<string, unknown>;
const fail = (code: string, path?: string): never => {
  throw new LocalAgentProjectLoaderError(code, path);
};
const obj = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (
  value: RecordValue,
  allowed: readonly string[],
  path: string,
): void => {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail('unknown_field', `${path}.${key}`);
};
const kebab = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value || value.length > MAX_SCALAR_LENGTH)
    fail('invalid_string', path);
  return value as string;
};

export interface LocalAgentProjectLoaderOptions {
  readonly manifestPath: string;
}

export async function loadLocalAgentProject(
  options: LocalAgentProjectLoaderOptions,
): Promise<NormalizedAgentProject> {
  try {
    return await loadLocalAgentProjectUnsafe(options);
  } catch (error) {
    if (error instanceof LocalAgentProjectLoaderError) throw error;
    throw new LocalAgentProjectLoaderError('filesystem_error', '$');
  }
}

async function loadLocalAgentProjectUnsafe(
  options: LocalAgentProjectLoaderOptions,
): Promise<NormalizedAgentProject> {
  const manifestPath = resolve(options.manifestPath);
  const root = dirname(manifestPath);
  if ((await realpath(root)) !== root) fail('root_symlink', '$manifest');
  const manifestSource = await readRegularFile(manifestPath, root, '$manifest');
  const raw = parseYaml(manifestSource);
  const manifest = parseManifest(raw);
  const tuples: SourceTuple[] = [];
  const toolProfiles = new Map();
  const skills = new Map();
  const environments = new Map();
  const agents = new Map();
  const teams = new Map();
  const memoryStores = new Map();

  for (const [name, spec] of Object.entries(manifest.spec.toolProfiles) as [
    string,
    any,
  ][]) {
    const path = await safePath(
      root,
      spec.file,
      false,
      `$.spec.toolProfiles.${name}.file`,
    );
    const source = await readRegularFile(
      path,
      root,
      `$.spec.toolProfiles.${name}.file`,
    );
    const profile = parseToolProfile(source, name);
    const ref = logicalRef('tool-profile', name);
    toolProfiles.set(ref, {
      ref,
      name,
      source,
      path: relativePath(root, path),
      sourceFingerprint: sha256(source),
      profile,
    } satisfies NormalizedLocalToolProfile);
    tuples.push({
      type: 'tool-profile',
      name,
      path: relativePath(root, path),
      digest: bareSha256(source),
    });
  }
  for (const [name, spec] of Object.entries(manifest.spec.skills) as [
    string,
    any,
  ][]) {
    const directory = await safePath(
      root,
      spec.directory,
      true,
      `$.spec.skills.${name}.directory`,
    );
    const files = await enumerateDirectory(directory, directory);
    if (
      files.reduce((sum, file) => sum + file.bytes.byteLength, 0) >
      MAX_SKILL_TOTAL_BYTES
    )
      fail('skill_total_size_limit');
    const metadataFile = files.find((file) => file.path === 'SKILL.md');
    if (!metadataFile)
      fail('missing_skill_metadata', `$.spec.skills.${name}.directory`);
    const metadata = metadataFile!;
    const digest = digestSkillFiles(
      files.map((file) => ({ path: file.path, bytes: file.bytes })),
    );
    const ref = logicalRef('skill', name);
    skills.set(ref, {
      name,
      directory: relativePath(root, directory),
      requiredTools: [...spec.requiredTools].sort(compareStrings),
      digest,
      sourceMetadata: metadata.bytes.toString('utf8'),
      sourceFingerprint: `sha256:${digest}`,
    });
    tuples.push({
      type: 'skill',
      name,
      path: relativePath(root, directory),
      digest,
    });
  }
  for (const [name, spec] of Object.entries(manifest.spec.environments) as [
    string,
    any,
  ][]) {
    const item = await readNative(root, spec.file, name, 'environment');
    parseManagedEnvironmentPackage(item.source);
    environments.set(logicalRef('environment', name), {
      name,
      path: item.relativePath,
      source: item.source,
      sourceFingerprint: sha256(item.source),
    });
    tuples.push({
      type: 'environment',
      name,
      path: item.relativePath,
      digest: bareSha256(item.source),
    });
  }
  for (const [name, spec] of Object.entries(manifest.spec.agents) as [
    string,
    any,
  ][]) {
    const item = await readNative(root, spec.file, name, 'agent');
    parseManagedAgentPackage(item.source);
    agents.set(logicalRef('agent', name), {
      name,
      path: item.relativePath,
      source: item.source,
      sourceFingerprint: sha256(item.source),
    });
    tuples.push({
      type: 'agent',
      name,
      path: item.relativePath,
      digest: bareSha256(item.source),
    });
  }
  for (const [name, spec] of Object.entries(manifest.spec.teams) as [
    string,
    any,
  ][]) {
    const item = await readNative(root, spec.file, name, 'team');
    parseProjectNativeEnvelope(
      item.source,
      'ManagedTeam',
      `source.team.${name}`,
    );
    teams.set(logicalRef('team', name), {
      name,
      path: item.relativePath,
      source: item.source,
      sourceFingerprint: sha256(item.source),
    });
    tuples.push({
      type: 'team',
      name,
      path: item.relativePath,
      digest: bareSha256(item.source),
    });
  }
  for (const [name, spec] of Object.entries(manifest.spec.memoryStores) as [
    string,
    any,
  ][]) {
    const seeds: {
      path: string;
      file: string;
      source: string;
      sourceFingerprint: string;
    }[] = [];
    for (const seed of spec.seeds) {
      const item = await readNative(root, seed.file, seed.path, 'memory-seed');
      const normalizedPath = normalizeSeedPath(
        seed.path,
        `$.spec.memoryStores.${name}.seeds`,
      );
      if (seeds.some((candidate) => candidate.path === normalizedPath))
        fail('duplicate_memory_seed', `$.spec.memoryStores.${name}.seeds`);
      seeds.push({
        path: normalizedPath,
        file: item.relativePath,
        source: item.source,
        sourceFingerprint: sha256(item.source),
      });
      tuples.push({
        type: 'memory-seed',
        name: `${name}/${normalizedPath}`,
        path: item.relativePath,
        digest: bareSha256(item.source),
      });
    }
    memoryStores.set(logicalRef('memory', name), {
      name: spec.name,
      description: spec.description,
      seeds,
    });
  }
  const entrypoints = manifest.spec.entrypoints.map((ref) => {
    if (!teams.has(ref)) fail('missing_reference', '$.spec.entrypoints');
    return ref;
  });
  if (!teams.has(manifest.spec.defaultEntrypoint))
    fail('missing_reference', '$.spec.defaultEntrypoint');
  if (!entrypoints.includes(manifest.spec.defaultEntrypoint))
    fail('default_entrypoint_not_declared', '$.spec.defaultEntrypoint');
  const normalizedManifest: AgentProjectManifest = {
    ...manifest,
    spec: {
      ...manifest.spec,
      skills: Object.fromEntries(
        Object.entries(manifest.spec.skills).map(([name, spec]) => [
          name,
          {
            ...spec,
            requiredTools: [...spec.requiredTools].sort(compareStrings),
          },
        ]),
      ),
      memoryStores: Object.fromEntries(
        Object.entries(manifest.spec.memoryStores).map(([name, spec]) => [
          name,
          {
            ...spec,
            seeds: [...spec.seeds].sort((a, b) =>
              compareStrings(a.path, b.path),
            ),
          },
        ]),
      ),
      entrypoints: [...manifest.spec.entrypoints].sort(compareStrings),
    },
  };
  return Object.freeze({
    manifest: normalizedManifest,
    workspace: 'workspace://default',
    toolProfiles,
    skills,
    environments,
    agents,
    teams,
    memoryStores,
    entrypoints: [...entrypoints].sort(compareStrings),
    defaultEntrypoint: manifest.spec.defaultEntrypoint,
    sourceTuples: tuples.sort(compareTuple),
    canonicalManifest: canonicalizeManifest(normalizedManifest),
    fingerprint: fingerprintProject(normalizedManifest, tuples),
  });
}

export class LocalAgentProjectLoader {
  public constructor(
    private readonly options: LocalAgentProjectLoaderOptions,
  ) {}
  public load(): Promise<NormalizedAgentProject> {
    return loadLocalAgentProject(this.options);
  }
}

function parseYaml(source: string): unknown {
  try {
    return parseManagedAgentYaml(source);
  } catch (error) {
    if (error instanceof ManagedAgentYamlError) fail(error.code, error.path);
    fail('yaml_invalid');
  }
  return undefined;
}
function parseManifest(input: unknown): AgentProjectManifest {
  const raw = input as any;
  if (!obj(raw)) fail('invalid_root');
  keys(raw, ['apiVersion', 'kind', 'metadata', 'spec'], '$');
  if (raw.apiVersion !== 'agent-server/v1alpha1' || raw.kind !== 'AgentProject')
    fail('invalid_kind');
  if (!obj(raw.metadata)) fail('invalid_metadata');
  keys(raw.metadata, ['name'], '$.metadata');
  if (!kebab(raw.metadata.name)) fail('invalid_name', '$.metadata.name');
  if (!obj(raw.spec)) fail('invalid_spec');
  keys(
    raw.spec,
    [
      'workspace',
      'toolProfiles',
      'skills',
      'environments',
      'agents',
      'teams',
      'memoryStores',
      'entrypoints',
      'defaultEntrypoint',
    ],
    '$.spec',
  );
  if (!obj(raw.spec.workspace)) fail('invalid_workspace');
  keys(raw.spec.workspace, ['name'], '$.spec.workspace');
  text(raw.spec.workspace.name, '$.spec.workspace.name');
  const maps = {} as Record<string, any>;
  for (const section of [
    'toolProfiles',
    'skills',
    'environments',
    'agents',
    'teams',
    'memoryStores',
  ]) {
    if (!obj(raw.spec[section])) fail('invalid_section', `$.spec.${section}`);
    maps[section] = raw.spec[section];
    for (const name of Object.keys(maps[section]))
      if (!kebab(name)) fail('invalid_map_key', `$.spec.${section}`);
  }
  const toolProfiles: Record<string, { file: string }> = {};
  for (const [name, value] of Object.entries(maps.toolProfiles) as [
    string,
    any,
  ][]) {
    if (!obj(value)) fail('invalid_entry');
    keys(value, ['file'], '$.spec.toolProfiles');
    toolProfiles[name] = { file: text(value.file, '$.file') };
  }
  const skills: Record<string, { directory: string; requiredTools: string[] }> =
    {};
  for (const [name, value] of Object.entries(maps.skills) as [string, any][]) {
    if (!obj(value)) fail('invalid_entry');
    keys(value, ['directory', 'requiredTools'], '$.spec.skills');
    if (
      !Array.isArray(value.requiredTools) ||
      value.requiredTools.length > MAX_COLLECTION_SIZE
    )
      fail('invalid_required_tools');
    const requiredTools = value.requiredTools.map((v: unknown) =>
      text(v, '$.requiredTools'),
    );
    const seenTools = new Set<string>();
    for (const toolRef of requiredTools) {
      if (seenTools.has(toolRef)) fail('duplicate_required_tool');
      seenTools.add(toolRef);
      validateProjectToolRef(toolRef, maps.toolProfiles);
    }
    skills[name] = {
      directory: text(value.directory, '$.directory'),
      requiredTools,
    };
  }
  const simple = (section: string): Record<string, { file: string }> => {
    const result: Record<string, { file: string }> = {};
    for (const [name, value] of Object.entries(maps[section]!) as [
      string,
      any,
    ][]) {
      if (!obj(value)) fail('invalid_entry');
      keys(value, ['file'], `$.spec.${section}`);
      result[name] = { file: text(value.file, '$.file') };
    }
    return result;
  };
  const memoryStores: Record<
    string,
    {
      name: string;
      description?: string;
      seeds: { path: string; file: string }[];
    }
  > = {};
  for (const [name, value] of Object.entries(maps.memoryStores) as [
    string,
    any,
  ][]) {
    if (!obj(value)) fail('invalid_entry');
    keys(value, ['name', 'description', 'seeds'], '$.spec.memoryStores');
    if (!Array.isArray(value.seeds) || value.seeds.length > MAX_COLLECTION_SIZE)
      fail('invalid_seeds');
    const seeds = value.seeds.map((seed: any) => {
      if (!obj(seed)) fail('invalid_seed');
      keys(seed, ['path', 'file'], '$.seed');
      return {
        path: normalizeSeedPath(text(seed.path, '$.path'), '$.path'),
        file: text(seed.file, '$.file'),
      };
    });
    memoryStores[name] = {
      name: text(value.name, '$.name'),
      ...(value.description === undefined
        ? {}
        : { description: text(value.description, '$.description') }),
      seeds: seeds.sort((a: { path: string }, b: { path: string }) =>
        compareStrings(a.path, b.path),
      ),
    };
  }
  if (
    !Array.isArray(raw.spec.entrypoints) ||
    !raw.spec.entrypoints.length ||
    raw.spec.entrypoints.length > MAX_COLLECTION_SIZE
  )
    fail('invalid_entrypoints');
  const entrypoints = raw.spec.entrypoints.map((ref: unknown) =>
    parseTeamRef(ref),
  );
  if (new Set(entrypoints).size !== entrypoints.length)
    fail('duplicate_entrypoint', '$.spec.entrypoints');
  const defaultEntrypoint = parseTeamRef(raw.spec.defaultEntrypoint);
  if (
    !maps.environments ||
    !Object.keys(maps.environments).length ||
    !Object.keys(maps.agents).length ||
    !Object.keys(maps.teams).length
  )
    fail('required_section_empty');
  return {
    apiVersion: raw.apiVersion,
    kind: raw.kind,
    metadata: { name: raw.metadata.name },
    spec: {
      workspace: { name: raw.spec.workspace.name },
      toolProfiles,
      skills,
      environments: simple('environments'),
      agents: simple('agents'),
      teams: simple('teams'),
      memoryStores,
      entrypoints,
      defaultEntrypoint,
    },
  };
}
function parseTeamRef(value: unknown) {
  if (typeof value !== 'string') fail('invalid_reference');
  const ref = parseLogicalRef(value as string);
  if (!ref.startsWith('team://')) fail('invalid_reference');
  return ref as `team://${string}`;
}

function validateProjectToolRef(
  value: string,
  toolProfiles: Record<string, unknown>,
): void {
  if (value.startsWith('tool-profile://')) {
    let ref: string | undefined;
    try {
      ref = parseLogicalRef(value);
    } catch {
      fail('invalid_tool_reference');
    }
    if (
      !ref ||
      !Object.prototype.hasOwnProperty.call(
        toolProfiles,
        ref.slice('tool-profile://'.length),
      )
    )
      fail('missing_tool_profile_reference');
    return;
  }
  if (
    /^(tool-profile|skill|environment|agent|team|memory|workspace):\/\//.test(
      value,
    )
  )
    fail('invalid_tool_reference');
  if (value.length > MAX_SCALAR_LENGTH || !isSafeNativeRef(value))
    fail('invalid_tool_reference');
}

function parseProjectNativeEnvelope(
  source: string,
  kind: string,
  path: string,
): void {
  const raw = parseYaml(source);
  if (!obj(raw)) fail('invalid_native_package', path);
  const envelope = raw as RecordValue;
  if (envelope.apiVersion !== 'agent-server/v1alpha1' || envelope.kind !== kind)
    fail('invalid_native_package', path);
  if (!obj(envelope.metadata) || !kebab(envelope.metadata.name))
    fail('invalid_native_package', path);
  if (!obj(envelope.spec)) fail('invalid_native_package', path);
}

function normalizeSeedPath(value: string, path: string): string {
  try {
    return normalizeMemoryPath(value);
  } catch {
    fail('invalid_memory_path', path);
  }
  return value;
}
function parseToolProfile(
  source: string,
  expectedName: string,
): LocalToolProfile {
  const raw = parseYaml(source) as any;
  if (!obj(raw)) fail('invalid_tool_profile');
  keys(raw, ['apiVersion', 'kind', 'metadata', 'spec'], '$');
  if (
    raw.apiVersion !== 'agent-server/v1alpha1' ||
    raw.kind !== 'LocalToolProfile'
  )
    fail('invalid_tool_profile');
  if (
    !obj(raw.metadata) ||
    Object.keys(raw.metadata).length !== 1 ||
    raw.metadata.name !== expectedName
  )
    fail('tool_profile_name_mismatch');
  if (
    !obj(raw.spec) ||
    Object.keys(raw.spec).some((key) => key !== 'tools') ||
    !Array.isArray(raw.spec.tools) ||
    raw.spec.tools.length < 1 ||
    raw.spec.tools.length > MAX_COLLECTION_SIZE
  )
    fail('invalid_tools');
  const seen = new Set<string>();
  const tools = raw.spec.tools.map((tool: any) => {
    if (
      !obj(tool) ||
      Object.keys(tool).some((key) => !['ref', 'kind'].includes(key)) ||
      typeof tool.ref !== 'string' ||
      !['tool', 'builtin'].includes(tool.kind as string)
    )
      fail('invalid_tool');
    validateNativeToolRef(tool.ref);
    if (seen.has(tool.ref)) fail('duplicate_tool');
    seen.add(tool.ref);
    return { ref: tool.ref as string, kind: tool.kind as 'tool' | 'builtin' };
  });
  return {
    apiVersion: 'agent-server/v1alpha1',
    kind: 'LocalToolProfile',
    metadata: { name: expectedName },
    spec: { tools },
  };
}

function validateNativeToolRef(value: string): void {
  if (value.length > MAX_SCALAR_LENGTH || !isSafeNativeRef(value))
    fail('invalid_tool');
}
async function readNative(
  root: string,
  sourcePath: string,
  name: string,
  type: string,
) {
  const field = `source.${type}`;
  const path = await safePath(root, sourcePath, false, field);
  const source = await readRegularFile(path, root, field);
  return { source, relativePath: relativePath(root, path), name, type };
}
async function safePath(
  root: string,
  value: string,
  directory: boolean,
  path: string,
): Promise<string> {
  if (
    !value ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    fail('unsafe_path', path);
  const candidate = resolve(root, value);
  if (!candidate.startsWith(`${resolve(root)}${sep}`))
    fail('path_escape', path);
  let current = root;
  for (const part of value.split('/')) {
    current = join(current, part);
    const stat = await lstat(current).catch(() => fail('missing_path', path));
    if (stat.isSymbolicLink()) fail('symlink_path', path);
  }
  const stat = await lstat(candidate);
  if (directory ? !stat.isDirectory() : !stat.isFile())
    fail('wrong_path_type', path);
  return candidate;
}
async function readRegularFile(
  path: string,
  root: string,
  field: string,
): Promise<string> {
  await safePath(root, relative(root, path).split(sep).join('/'), false, field);
  try {
    return await readFile(path, 'utf8');
  } catch {
    fail('read_failed', field);
  }
  return '';
}
async function enumerateDirectory(
  directory: string,
  skillRoot: string,
  depth = 0,
  state: {
    readonly result: { path: string; bytes: Buffer }[];
    total: number;
  } = {
    result: [],
    total: 0,
  },
): Promise<{ path: string; bytes: Buffer }[]> {
  if (depth > MAX_COLLECTION_SIZE) fail('skill_depth_limit');
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : 1),
  )) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) fail('symlink_path');
    if (stat.isDirectory())
      await enumerateDirectory(path, skillRoot, depth + 1, state);
    else if (stat.isFile()) {
      if ((stat.mode & 0o111) !== 0) fail('skill_executable_file');
      if (state.result.length >= MAX_SKILL_FILES) fail('skill_file_limit');
      if (stat.size > MAX_SKILL_FILE_BYTES) fail('skill_file_size_limit');
      const bytes = await readFile(path);
      if (bytes.byteLength > MAX_SKILL_FILE_BYTES)
        fail('skill_file_size_limit');
      state.total += bytes.byteLength;
      if (state.total > MAX_SKILL_TOTAL_BYTES) fail('skill_total_size_limit');
      state.result.push({
        path: relative(skillRoot, path).split(sep).join('/'),
        bytes,
      });
    } else fail('invalid_skill_entry');
  }
  return state.result;
}
function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}
function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function bareSha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function compareTuple(a: SourceTuple, b: SourceTuple): number {
  return `${a.type}\0${a.name}\0${a.path}` < `${b.type}\0${b.name}\0${b.path}`
    ? -1
    : 1;
}
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
