import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { stringify } from 'yaml';
import {
  parseManagedAgentYaml,
  ManagedAgentYamlError,
  MAX_COLLECTION_SIZE,
  MAX_SCALAR_LENGTH,
} from '../../domain/agents/managed-agent-yaml.js';
import {
  ManagedAgentPackageError,
  parseManagedAgentPackage,
} from '../../domain/agents/managed-agent-package.js';
import {
  ManagedEnvironmentPackageError,
  parseManagedEnvironmentPackage,
} from '../../domain/environments/managed-environment-package.js';
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
import { renderProjectTeam } from '../../application/projects/render-project-team.js';
import { ProjectTeamRenderError } from '../../application/projects/render-project-team.js';
import { TeamPackageValidationError } from '../../domain/teams/managed-team-package.js';
import { canonicalTeamToolRefsForRole } from '../../domain/teams/canonical-team-role-tools.js';
import type { AgentProjectSectionEntry } from '../../domain/projects/agent-project.js';

export class LocalAgentProjectLoaderError extends Error {
  public constructor(
    readonly code: string,
    readonly path = '$',
    message = `${code} at ${path}`,
  ) {
    super(message);
    this.name = 'LocalAgentProjectLoaderError';
  }
}

type RecordValue = Record<string, unknown>;
const fail = (code: string, path?: string, message?: string): never => {
  throw new LocalAgentProjectLoaderError(code, path, message);
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
    const ref = logicalRef('tool-profile', name);
    let canonicalSource: string;
    let profile: LocalToolProfile;
    try {
      canonicalSource = canonicalizeSource(source);
      profile = parseToolProfile(canonicalSource, name);
    } catch (error) {
      rethrowResourceError(error, `$.spec.toolProfiles.${name}`);
    }
    toolProfiles.set(ref, {
      ref,
      name,
      source: canonicalSource,
      path: virtualPath('tool-profile', name),
      sourceFingerprint: sha256(canonicalSource),
      profile,
    } satisfies NormalizedLocalToolProfile);
    tuples.push({
      type: 'tool-profile',
      name,
      path: virtualPath('tool-profile', name),
      digest: bareSha256(canonicalSource),
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
    let item: Awaited<ReturnType<typeof readProjectSource>>;
    try {
      item = await readProjectSource(root, spec, name, 'environment');
      parseManagedEnvironmentPackage(item.source);
    } catch (error) {
      rethrowResourceError(error, `$.spec.environments.${name}`);
    }
    environments.set(logicalRef('environment', name), {
      name,
      path: virtualPath('environment', name),
      source: item.source,
      sourceFingerprint: sha256(item.source),
    });
    tuples.push({
      type: 'environment',
      name,
      path: virtualPath('environment', name),
      digest: bareSha256(item.source),
    });
  }
  for (const [name, spec] of Object.entries(manifest.spec.agents) as [
    string,
    any,
  ][]) {
    let item: Awaited<ReturnType<typeof readProjectSource>>;
    try {
      item = await readProjectSource(root, spec, name, 'agent');
      parseManagedAgentPackage(item.source);
    } catch (error) {
      rethrowResourceError(error, `$.spec.agents.${name}`);
    }
    agents.set(logicalRef('agent', name), {
      name,
      path: virtualPath('agent', name),
      source: item.source,
      sourceFingerprint: sha256(item.source),
    });
    tuples.push({
      type: 'agent',
      name,
      path: virtualPath('agent', name),
      digest: bareSha256(item.source),
    });
    for (const role of ['lead', 'member'] as const) {
      if (!agentDeclaresToolProfile(item.source, `tool-profile://team-${role}`))
        continue;
      const profileName = `team-${role}`;
      const ref = logicalRef('tool-profile', profileName);
      if (toolProfiles.has(ref)) continue;
      const profile = builtinToolProfile(profileName, role);
      const profileSource = canonicalizeSource(
        stringify(profile, { lineWidth: 0 }),
      );
      toolProfiles.set(ref, {
        ref,
        name: profileName,
        source: profileSource,
        path: virtualPath('tool-profile', profileName),
        sourceFingerprint: sha256(profileSource),
        profile: parseToolProfile(profileSource, profileName),
      });
      tuples.push({
        type: 'tool-profile',
        name: profileName,
        path: virtualPath('tool-profile', profileName),
        digest: bareSha256(profileSource),
      });
    }
  }
  for (const [name, spec] of Object.entries(manifest.spec.teams) as [
    string,
    any,
  ][]) {
    let item: Awaited<ReturnType<typeof readProjectSource>>;
    try {
      item = await readProjectSource(root, spec, name, 'team');
      parseProjectNativeEnvelope(
        item.source,
        'ManagedTeam',
        `source.team.${name}`,
        environments,
        agents,
      );
    } catch (error) {
      rethrowResourceError(error, `$.spec.teams.${name}`);
    }
    teams.set(logicalRef('team', name), {
      name,
      path: virtualPath('team', name),
      source: item.source,
      sourceFingerprint: sha256(item.source),
    });
    tuples.push({
      type: 'team',
      name,
      path: virtualPath('team', name),
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
      toolProfiles: Object.fromEntries(
        [...toolProfiles.keys()]
          .map((ref) => ref.slice('tool-profile://'.length))
          .sort(compareStrings)
          .map((name) => [name, { file: virtualPath('tool-profile', name) }]),
      ),
      environments: Object.fromEntries(
        Object.keys(manifest.spec.environments).map((name) => [
          name,
          { file: virtualPath('environment', name) },
        ]),
      ),
      agents: Object.fromEntries(
        Object.keys(manifest.spec.agents).map((name) => [
          name,
          { file: virtualPath('agent', name) },
        ]),
      ),
      teams: Object.fromEntries(
        Object.keys(manifest.spec.teams).map((name) => [
          name,
          { file: virtualPath('team', name) },
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
  const candidate: NormalizedAgentProject = {
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
  };
  for (const name of Object.keys(manifest.spec.teams)) {
    try {
      renderProjectTeam({
        project: candidate,
        team: logicalRef('team', name),
        mode: 'plan',
      });
    } catch (error) {
      rethrowResourceError(error, `$.spec.teams.${name}`);
    }
  }
  return Object.freeze(candidate);
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
    if (
      (section === 'toolProfiles' ||
        section === 'skills' ||
        section === 'memoryStores') &&
      raw.spec[section] === undefined
    ) {
      maps[section] = {};
      continue;
    }
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
    if (name === 'team-lead' || name === 'team-member')
      fail('reserved_tool_profile_name', `$.spec.toolProfiles.${name}`);
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
  const simple = (
    section: string,
  ): Record<string, AgentProjectSectionEntry> => {
    const result: Record<string, AgentProjectSectionEntry> = {};
    for (const [name, value] of Object.entries(maps[section]!) as [
      string,
      any,
    ][]) {
      if (!obj(value)) fail('invalid_entry');
      if (Object.prototype.hasOwnProperty.call(value, 'file')) {
        keys(value, ['file'], `$.spec.${section}`);
        result[name] = { file: text(value.file, '$.file') };
      } else {
        result[name] = { ...value };
      }
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
  environments?: ReadonlyMap<string, unknown>,
  agents?: ReadonlyMap<string, unknown>,
): void {
  const raw = parseYaml(source);
  if (!obj(raw)) fail('invalid_native_package', path);
  const envelope = raw as RecordValue;
  if (envelope.apiVersion !== 'agent-server/v1alpha1' || envelope.kind !== kind)
    fail('invalid_native_package', path);
  if (!obj(envelope.metadata) || !kebab(envelope.metadata.name))
    fail('invalid_native_package', path);
  if (!obj(envelope.spec)) fail('invalid_native_package', path);
  if (kind === 'ManagedTeam')
    validateLogicalTeamSpec(
      envelope.spec as RecordValue,
      path,
      environments,
      agents,
    );
}

function rethrowResourceError(error: unknown, prefix: string): never {
  if (
    error instanceof LocalAgentProjectLoaderError ||
    error instanceof ManagedAgentPackageError ||
    error instanceof ManagedEnvironmentPackageError ||
    error instanceof ProjectTeamRenderError ||
    error instanceof TeamPackageValidationError
  ) {
    const code = error.code;
    const path = qualifyResourcePath(
      prefix,
      'path' in error ? error.path : '$',
    );
    const original = error instanceof Error ? error.message : code;
    const generatedMessage =
      original === code || original.startsWith(`${code} at `);
    const message = generatedMessage ? `${code} at ${path}` : original;
    throw new LocalAgentProjectLoaderError(code, path, message);
  }
  throw error;
}

function qualifyResourcePath(prefix: string, path: unknown): string {
  if (typeof path !== 'string' || path === '$') return prefix;
  if (path.startsWith('$.spec'))
    return `${prefix}${path.slice('$.spec'.length)}`;
  if (path.startsWith('source.')) {
    let suffix = path.split('.').slice(3).join('.');
    if (suffix.startsWith('spec.')) suffix = suffix.slice('spec.'.length);
    return suffix ? `${prefix}.${suffix}` : prefix;
  }
  if (path.startsWith('$.')) return `${prefix}${path.slice(1)}`;
  return prefix;
}

function validateLogicalTeamSpec(
  spec: RecordValue,
  path: string,
  environments?: ReadonlyMap<string, unknown>,
  agents?: ReadonlyMap<string, unknown>,
): void {
  const check = (
    value: unknown,
    prefix: string,
    kind: 'environment' | 'agent',
  ) => {
    if (typeof value !== 'string' || !value.includes('://')) return;
    let ref = '';
    try {
      ref = parseLogicalRef(value);
    } catch {
      fail('invalid_reference', prefix);
    }
    if (!ref.startsWith(`${kind}://`)) fail('invalid_reference', prefix);
    const exists =
      kind === 'environment' ? environments?.has(ref) : agents?.has(ref);
    if (exists === false) fail('missing_reference', prefix);
  };
  check(
    spec.environmentVersionId,
    `${path}.spec.environmentVersionId`,
    'environment',
  );
  if (obj(spec.lead))
    check(
      spec.lead.agentVersionId,
      `${path}.spec.lead.agentVersionId`,
      'agent',
    );
  if (Array.isArray(spec.roster))
    spec.roster.forEach((member, index) => {
      if (obj(member))
        check(
          member.agentVersionId,
          `${path}.spec.roster[${index}].agentVersionId`,
          'agent',
        );
    });
}

async function readProjectSource(
  root: string,
  spec: AgentProjectSectionEntry,
  name: string,
  kind: 'environment' | 'agent' | 'team',
): Promise<{ source: string; relativePath?: string }> {
  let raw: unknown;
  const fileBacked = obj(spec) && typeof spec.file === 'string';
  if (fileBacked) {
    const path = await safePath(
      root,
      spec.file,
      false,
      `source.${kind}.${name}`,
    );
    raw = parseYaml(
      await readRegularFile(path, root, `source.${kind}.${name}`),
    );
  } else
    raw = {
      apiVersion: 'agent-server/v1alpha1',
      kind:
        kind === 'environment'
          ? 'ManagedEnvironment'
          : kind === 'agent'
            ? 'ManagedAgent'
            : 'ManagedTeam',
      metadata: { name },
      spec: spec as RecordValue,
    };
  if (!obj(raw)) fail('invalid_native_package', `source.${kind}.${name}`);
  const envelope = { ...(raw as RecordValue) } as RecordValue;
  const defaults = defaultsFor(kind);
  if (!fileBacked) envelope.metadata = { name };
  envelope.spec = mergeDefaults(
    obj(envelope.spec) ? envelope.spec : {},
    defaults,
  );
  return {
    source: canonicalizeSource(
      stringify(sortYamlValue(envelope), { lineWidth: 0 }),
    ),
  };
}

function defaultsFor(kind: 'environment' | 'agent' | 'team'): RecordValue {
  if (kind === 'environment')
    return {
      adapter: 'paseo',
      provider: 'opencode',
      modelPolicyRef: 'free-only',
      runtimeCellPolicy: 'per_runtime_session',
    };
  if (kind === 'team')
    return { coordination: { taskAssignment: 'lead_or_self_claim' } };
  return {
    runtime: {
      provider: 'paseo',
      modelPolicyRef: 'free-only',
      mode: 'isolated',
    },
    skills: [],
    session: {
      invocation: 'fresh_per_invocation',
      followUps: 'queued',
      binding: 'reusable',
    },
    memory: { policy: 'workspace_snapshot', proposalLimit: 0 },
    permissions: { network: 'none', filesystem: 'none' },
    completion: { type: 'executable' },
  };
}

function mergeDefaults(value: RecordValue, defaults: RecordValue): RecordValue {
  const result: RecordValue = { ...value };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in result)) result[key] = defaultValue;
    else if (obj(defaultValue) && obj(result[key]))
      result[key] = mergeDefaults(
        result[key] as RecordValue,
        defaultValue as RecordValue,
      );
  }
  return result;
}

function canonicalizeSource(source: string): string {
  const raw = parseYaml(source);
  return stringify(sortYamlValue(raw), { lineWidth: 0 });
}

function sortYamlValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortYamlValue);
  if (obj(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, sortYamlValue(value[key])]),
    );
  return value;
}

function virtualPath(
  type: 'tool-profile' | 'environment' | 'agent' | 'team',
  name: string,
): string {
  const directory = type === 'tool-profile' ? 'tool-profiles' : `${type}s`;
  return `${directory}/${name}.yaml`;
}

function agentDeclaresToolProfile(source: string, ref: string): boolean {
  const raw = parseYaml(source);
  if (!obj(raw) || !obj(raw.spec) || !Array.isArray(raw.spec.tools))
    return false;
  return raw.spec.tools.some((tool) => obj(tool) && tool.ref === ref);
}

function builtinToolProfile(
  name: string,
  role: 'lead' | 'member',
): RecordValue {
  return {
    apiVersion: 'agent-server/v1alpha1',
    kind: 'LocalToolProfile',
    metadata: { name },
    spec: {
      tools: canonicalTeamToolRefsForRole(role).map((ref) => ({
        ref,
        kind: 'tool',
      })),
    },
  };
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
