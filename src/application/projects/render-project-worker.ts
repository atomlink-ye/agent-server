import {
  MAX_COLLECTION_SIZE,
  MAX_SCALAR_LENGTH,
  parseManagedAgentYaml,
} from '../../domain/agents/managed-agent-yaml.js';
import type { ParsedWorkerPackage } from '../../domain/workers/worker-package.js';
import { parseWorkerForImport } from '../workers/validate-worker-package.js';
import type { NormalizedAgentProject } from '../../domain/projects/agent-project.js';
import {
  parseLogicalRef,
  type WorkerRef,
} from '../../domain/projects/logical-ref.js';
import { isSafeNativeRef } from '../../domain/projects/safe-ref.js';
import {
  canonicalizeYaml,
  compareStrings,
  sha256,
} from '../../domain/projects/yaml-canonical.js';
import { SUPPORTED_MANAGED_AGENT_TOOL_REFS } from '../agents/built-in-skills.js';
import type { Sha256Fingerprint } from '../../domain/projects/project-canonicalization.js';

export class ProjectWorkerRenderError extends Error {
  public constructor(
    readonly code: string,
    readonly path = '$',
  ) {
    super(code);
    this.name = 'ProjectWorkerRenderError';
  }
}

export interface RenderedProjectWorker {
  readonly source: string;
  readonly sourceFingerprint: Sha256Fingerprint;
  readonly nativeFingerprint: Sha256Fingerprint;
  readonly expandedSkills: readonly string[];
  readonly expandedTools: readonly string[];
  readonly dependencies: readonly string[];
  readonly nativeParserResult: ParsedWorkerPackage;
}

export interface RenderProjectWorkerInput {
  readonly project: NormalizedAgentProject;
  readonly worker: WorkerRef;
  readonly source?: string;
}

export function renderProjectWorker(
  input: RenderProjectWorkerInput,
): RenderedProjectWorker {
  if (!isWorkerRef(input.worker))
    throw new ProjectWorkerRenderError('invalid_worker_reference');
  const record = input.project.workers.get(input.worker);
  if (!record) throw new ProjectWorkerRenderError('missing_worker_reference');
  const source = input.source ?? record.source;
  const raw = parseProjectYaml(source);
  const root = object(raw, '$');
  const spec = object(root.spec, '$.spec');
  const skills = collection(spec.skills, '$.spec.skills');
  const tools = collection(spec.tools, '$.spec.tools');
  const expandedSkills: string[] = [];
  const expandedTools: string[] = [];
  const dependencies = new Set<string>();
  const seenSkills = new Set<string>();
  const seenTools = new Map<string, string | undefined>();
  const requiredNativeTools = new Set<string>();

  const renderedSkills = skills.map((entry, index) => {
    const item = object(entry, `$.spec.skills[${index}]`);
    exactKeys(item, ['ref'], `$.spec.skills[${index}]`);
    const ref = requiredString(item.ref, `$.spec.skills[${index}].ref`);
    if (isLogicalKind(ref, 'skill')) {
      const skill = input.project.skills.get(ref as `skill://${string}`);
      if (!skill)
        throw new ProjectWorkerRenderError(
          'missing_skill_reference',
          `$.spec.skills[${index}].ref`,
        );
      const name = ref.slice('skill://'.length);
      const rendered = `project/${input.project.manifest.metadata.name}/${name}`;
      if (seenSkills.has(rendered))
        throw new ProjectWorkerRenderError('duplicate_skill_reference');
      seenSkills.add(rendered);
      expandedSkills.push(rendered);
      dependencies.add(ref);
      const skillRequiredTools = new Set<string>();
      for (const required of skill.requiredTools) {
        addRequiredTools(
          required,
          `$.spec.skills[${index}].ref`,
          input.project,
          dependencies,
          skillRequiredTools,
          requiredNativeTools,
        );
      }
      return { ...item, ref: rendered };
    }
    if (ref.includes('://'))
      throw new ProjectWorkerRenderError(
        'invalid_skill_reference',
        `$.spec.skills[${index}].ref`,
      );
    if (ref.length > MAX_SCALAR_LENGTH || !isSafeNativeRef(ref))
      throw new ProjectWorkerRenderError(
        'invalid_skill_reference',
        `$.spec.skills[${index}].ref`,
      );
    rejectProjectScheme(ref, 'skill', `$.spec.skills[${index}].ref`);
    if (seenSkills.has(ref))
      throw new ProjectWorkerRenderError('duplicate_skill_reference');
    seenSkills.add(ref);
    expandedSkills.push(ref);
    return { ...item, ref };
  });

  const renderedTools = tools.flatMap((entry, index) => {
    const item = object(entry, `$.spec.tools[${index}]`);
    if (
      isLogicalKind(
        requiredString(item.ref, `$.spec.tools[${index}].ref`),
        'tool-profile',
      )
    )
      exactKeys(item, ['ref'], `$.spec.tools[${index}]`);
    const ref = requiredString(item.ref, `$.spec.tools[${index}].ref`);
    if (isLogicalKind(ref, 'tool-profile')) {
      const profile = input.project.toolProfiles.get(
        ref as `tool-profile://${string}`,
      );
      if (!profile)
        throw new ProjectWorkerRenderError(
          'missing_tool_profile_reference',
          `$.spec.tools[${index}].ref`,
        );
      dependencies.add(ref);
      return profile.profile.spec.tools.map((tool) => {
        ensureSupportedTool(tool.ref, `$.spec.tools[${index}].ref`);
        addTool(seenTools, tool.ref, tool.kind, `$.spec.tools[${index}]`);
        expandedTools.push(tool.ref);
        return { ref: tool.ref, kind: tool.kind };
      });
    }
    rejectProjectScheme(ref, 'tool', `$.spec.tools[${index}].ref`);
    if (!isSafeNativeRef(ref))
      throw new ProjectWorkerRenderError(
        'invalid_tool_reference',
        `$.spec.tools[${index}].ref`,
      );
    ensureSupportedTool(ref, `$.spec.tools[${index}].ref`);
    const kind = typeof item.kind === 'string' ? item.kind : undefined;
    addTool(seenTools, ref, kind, `$.spec.tools[${index}]`);
    expandedTools.push(ref);
    return [{ ...item, ref }];
  });
  if (renderedTools.length > MAX_COLLECTION_SIZE)
    throw new ProjectWorkerRenderError('collection_limit', '$.spec.tools');

  const rendered = canonicalizeYaml({
    ...root,
    spec: { ...spec, skills: renderedSkills, tools: renderedTools },
  });
  const nativeParserResult = parseWorkerForImport(rendered);
  for (const required of requiredNativeTools) {
    if (!seenTools.has(required))
      throw new ProjectWorkerRenderError('required_tool_not_granted');
  }
  return {
    source: rendered,
    sourceFingerprint: sha256(source),
    nativeFingerprint: nativeParserResult.fingerprint as Sha256Fingerprint,
    expandedSkills,
    expandedTools,
    dependencies: [...dependencies].sort(compareStrings),
    nativeParserResult,
  };
}

function addTool(
  seen: Map<string, string | undefined>,
  ref: string,
  kind: string | undefined,
  path: string,
): void {
  if (seen.has(ref) && seen.get(ref) !== kind)
    throw new ProjectWorkerRenderError('conflicting_tool_reference', path);
  if (seen.has(ref))
    throw new ProjectWorkerRenderError('duplicate_tool_reference', path);
  seen.set(ref, kind);
}
function rejectProjectScheme(
  value: string,
  allowed: string,
  path: string,
): void {
  if (
    /^(tool-profile|skill|environment|worker|agent|team|memory|workspace):\/\//.test(
      value,
    )
  )
    throw new ProjectWorkerRenderError(`invalid_${allowed}_reference`, path);
  if (value.length > MAX_SCALAR_LENGTH)
    throw new ProjectWorkerRenderError('scalar_limit', path);
}
function isLogicalKind(value: string, kind: 'skill' | 'tool-profile'): boolean {
  try {
    return parseLogicalRef(value).startsWith(`${kind}://`);
  } catch {
    return false;
  }
}
function isWorkerRef(value: string): boolean {
  try {
    return parseLogicalRef(value).startsWith('worker://');
  } catch {
    return false;
  }
}
function exactKeys(
  value: Record<string, any>,
  allowed: readonly string[],
  path: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ProjectWorkerRenderError('invalid_reference', path);
}
function ensureSupportedTool(ref: string, path: string): void {
  if (!SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(ref))
    throw new ProjectWorkerRenderError('unsupported_tool_reference', path);
}
function addRequiredTools(
  value: string,
  path: string,
  project: NormalizedAgentProject,
  dependencies: Set<string>,
  skillRequiredTools: Set<string>,
  requiredNativeTools: Set<string>,
): void {
  if (isLogicalKind(value, 'tool-profile')) {
    const profile = project.toolProfiles.get(value as any);
    if (!profile)
      throw new ProjectWorkerRenderError(
        'missing_tool_profile_reference',
        path,
      );
    dependencies.add(value);
    for (const tool of profile.profile.spec.tools) {
      ensureSupportedTool(tool.ref, path);
      addRequiredTool(tool.ref, path, skillRequiredTools, requiredNativeTools);
    }
    return;
  }
  if (
    value.includes('://') ||
    value.length > MAX_SCALAR_LENGTH ||
    !isSafeNativeRef(value)
  )
    throw new ProjectWorkerRenderError('invalid_tool_reference', path);
  ensureSupportedTool(value, path);
  addRequiredTool(value, path, skillRequiredTools, requiredNativeTools);
}
function addRequiredTool(
  value: string,
  path: string,
  skillRequiredTools: Set<string>,
  requiredNativeTools: Set<string>,
): void {
  if (skillRequiredTools.has(value))
    throw new ProjectWorkerRenderError(
      'duplicate_required_tool_reference',
      path,
    );
  skillRequiredTools.add(value);
  requiredNativeTools.add(value);
  if (
    skillRequiredTools.size > MAX_COLLECTION_SIZE ||
    requiredNativeTools.size > MAX_COLLECTION_SIZE
  )
    throw new ProjectWorkerRenderError('collection_limit', path);
}
function parseProjectYaml(source: string): unknown {
  try {
    return parseManagedAgentYaml(source);
  } catch (error) {
    throw new ProjectWorkerRenderError('invalid_yaml', '$');
  }
}
function object(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProjectWorkerRenderError('invalid_object', path);
  return value as Record<string, any>;
}
function collection(value: unknown, path: string): Record<string, any>[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_SIZE)
    throw new ProjectWorkerRenderError('invalid_collection', path);
  return value as Record<string, any>[];
}
function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value)
    throw new ProjectWorkerRenderError('invalid_reference', path);
  return value;
}
