import { createHash } from 'node:crypto';
import {
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_COLLECTION_SIZE,
  MAX_SCALAR_LENGTH,
  MAX_SOURCE_BYTES,
  ManagedAgentYamlError,
  parseManagedAgentYaml,
} from './managed-agent-yaml.js';
import {
  MAX_SCHEMA_DEPTH,
  type JsonSchema,
  ManagedAgentSchemaError,
  validateJsonSchema,
} from './managed-agent-schema.js';
import {
  MANAGED_PATTERN_COMPILER_VERSION,
  MANAGED_PATTERN_DIALECT,
  MAX_MANAGED_PATTERN_INPUT_LENGTH,
  MAX_MANAGED_PATTERN_LENGTH,
  MAX_MANAGED_PATTERN_PROGRAM_SIZE,
} from './managed-agent-pattern.js';
import {
  MAX_MANAGED_AGENT_NAME_BYTES,
  normalizeManagedAgentName,
} from './managed-agent-owner.js';

export {
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_COLLECTION_SIZE,
  MAX_MANAGED_PATTERN_INPUT_LENGTH,
  MAX_MANAGED_PATTERN_LENGTH,
  MAX_MANAGED_PATTERN_PROGRAM_SIZE,
  MAX_MANAGED_AGENT_NAME_BYTES,
  MAX_SCALAR_LENGTH,
  MAX_SCHEMA_DEPTH,
  MAX_SOURCE_BYTES,
};
export const BUILT_IN_MODEL_POLICY_REFS = Object.freeze(['free-only'] as const);
export type ModelPolicyRef = string;

export interface ManagedAgentPackage {
  readonly apiVersion: 'agent-server/v1alpha1';
  readonly kind: 'ManagedAgent';
  readonly metadata: { readonly name: string };
  readonly spec: {
    readonly description: string;
    readonly instructions: string;
    readonly runtime: {
      readonly provider: 'paseo';
      readonly modelPolicyRef: string;
      readonly mode: 'isolated' | 'shared';
    };
    readonly tools: readonly {
      readonly ref: string;
      readonly kind?: 'tool' | 'builtin';
    }[];
    readonly skills: readonly { readonly ref: string }[];
    readonly input: {
      readonly schema: JsonSchema;
      readonly prompt: CompiledPrompt;
    };
    readonly session: {
      readonly invocation: 'fresh_per_invocation';
      readonly followUps: 'queued';
      readonly binding: 'reusable';
    };
    readonly memory: {
      readonly policy: 'workspace_snapshot';
      readonly proposalLimit: number;
    };
    readonly permissions: {
      readonly network: 'none' | 'read_only';
      readonly filesystem: 'none' | 'workspace_read';
    };
    readonly completion: {
      readonly type: 'executable';
      readonly command: string;
    };
  };
}
export type { JsonSchema } from './managed-agent-schema.js';
export interface CompiledPrompt {
  readonly template: string;
  readonly segments: readonly (
    { readonly field: string } | { readonly text: string }
  )[];
}
export class ManagedAgentPackageError extends Error {
  constructor(
    readonly code: string,
    readonly path = '$',
  ) {
    super(code);
    this.name = 'ManagedAgentPackageError';
  }
}
export interface ParsedManagedAgentPackage {
  readonly package: ManagedAgentPackage;
  readonly canonicalJson: string;
  readonly fingerprint: string;
  readonly normalizedName: string;
  readonly compiler: {
    readonly patternDialect: typeof MANAGED_PATTERN_DIALECT;
    readonly patternCompilerVersion: typeof MANAGED_PATTERN_COMPILER_VERSION;
  };
}

const fail = (code: string, path?: string): never => {
  throw new ManagedAgentPackageError(code, path);
};
const isObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (
  x: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) => {
  for (const k of Object.keys(x))
    if (!allowed.includes(k)) fail('unknown_field', `${path}.__unknown__`);
};
const nonEmpty = (x: unknown, path: string): string =>
  typeof x === 'string' && x.trim() ? x : fail('invalid_string', path);

function compilePrompt(value: unknown, fields: Set<string>): CompiledPrompt {
  if (typeof value !== 'string')
    fail('invalid_template', '$.spec.input.prompt');
  const template = value as string;
  if (template.length > MAX_SCALAR_LENGTH)
    fail('invalid_template', '$.spec.input.prompt');
  const segments: Array<{ field: string } | { text: string }> = [];
  let last = 0;
  const re = /{{\s*input\.([A-Za-z_][A-Za-z0-9_]*)\s*}}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template))) {
    const field = match[1] ?? fail('invalid_template', '$.spec.input.prompt');
    if (match.index > last)
      segments.push({ text: template.slice(last, match.index) });
    if (!fields.has(field))
      fail('undeclared_template_field', '$.spec.input.prompt');
    segments.push({ field });
    last = re.lastIndex;
  }
  if (last < template.length) segments.push({ text: template.slice(last) });
  if (
    segments.some(
      (segment) =>
        'text' in segment &&
        (segment.text.includes('{{') || segment.text.includes('}}')),
    )
  )
    fail('invalid_template', '$.spec.input.prompt');
  return { template, segments };
}

function scanSecrets(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    if (
      /BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY|\bBearer\s+[A-Za-z0-9._~-]{12,}|(?:password|passwd|secret|token)\s*[:=]\s*[^\s]{8,}/i.test(
        value,
      )
    )
      fail('secret_detected', path);
    return;
  }
  if (Array.isArray(value))
    value.forEach((v, i) => scanSecrets(v, `${path}[${i}]`));
  else if (isObject(value))
    Object.values(value).forEach((v, i) => scanSecrets(v, `${path}[${i}]`));
}

export function parseManagedAgentPackage(
  source: string,
): ParsedManagedAgentPackage {
  let raw: any;
  try {
    raw = parseManagedAgentYaml(source);
  } catch (e) {
    if (e instanceof ManagedAgentYamlError) fail(e.code, e.path);
    fail('yaml_invalid');
  }
  if (!isObject(raw)) fail('invalid_root');
  keys(raw, ['apiVersion', 'kind', 'metadata', 'spec'], '$');
  if (raw.apiVersion !== 'agent-server/v1alpha1')
    fail('invalid_api_version', '$.apiVersion');
  if (raw.kind !== 'ManagedAgent') fail('invalid_kind', '$.kind');
  const metadata = raw.metadata;
  if (!isObject(metadata)) fail('invalid_metadata', '$.metadata');
  keys(metadata, ['name'], '$.metadata');
  const name = nonEmpty(metadata.name, '$.metadata.name');
  const normalizedName = normalizeManagedAgentName(name);
  if (!normalizedName) fail('invalid_name', '$.metadata.name');
  const s = raw.spec;
  if (!isObject(s)) fail('invalid_spec', '$.spec');
  keys(
    s,
    [
      'description',
      'instructions',
      'runtime',
      'tools',
      'skills',
      'input',
      'session',
      'memory',
      'permissions',
      'completion',
    ],
    '$.spec',
  );
  const runtime = s.runtime;
  if (!isObject(runtime)) fail('invalid_runtime', '$.spec.runtime');
  keys(runtime, ['provider', 'modelPolicyRef', 'mode'], '$.spec.runtime');
  if (runtime.provider !== 'paseo') fail('invalid_provider');
  if (
    typeof runtime.modelPolicyRef !== 'string' ||
    !BUILT_IN_MODEL_POLICY_REFS.includes(
      runtime.modelPolicyRef as (typeof BUILT_IN_MODEL_POLICY_REFS)[number],
    )
  )
    fail('model_policy_not_allowed', '$.spec.runtime.modelPolicyRef');
  if (!['isolated', 'shared'].includes(String(runtime.mode)))
    fail('invalid_mode');
  const input = s.input;
  if (!isObject(input)) fail('invalid_input');
  keys(input, ['schema', 'prompt'], '$.spec.input');
  let js = input.schema as JsonSchema;
  try {
    js = validateJsonSchema(input.schema);
  } catch (e) {
    if (e instanceof ManagedAgentSchemaError) fail(e.code, e.path);
    fail('invalid_schema');
  }
  const fields = new Set(Object.keys((input.schema as any).properties ?? {}));
  const prompt = compilePrompt(input.prompt, fields);
  const tools = s.tools;
  if (!Array.isArray(tools) || tools.length > MAX_COLLECTION_SIZE)
    fail('invalid_references', '$.spec.tools');
  for (const [i, tool] of tools.entries()) {
    if (!isObject(tool)) fail('invalid_references', `$.spec.tools[${i}]`);
    keys(tool, ['ref', 'kind'], `$.spec.tools[${i}]`);
    nonEmpty(tool.ref, `$.spec.tools[${i}].ref`);
    if (
      tool.kind !== undefined &&
      !['tool', 'builtin'].includes(String(tool.kind))
    )
      fail('invalid_references', `$.spec.tools[${i}].kind`);
  }
  const skills = s.skills;
  if (!Array.isArray(skills) || skills.length > MAX_COLLECTION_SIZE)
    fail('invalid_references', '$.spec.skills');
  for (const [i, skill] of skills.entries()) {
    if (!isObject(skill)) fail('invalid_references', `$.spec.skills[${i}]`);
    keys(skill, ['ref'], `$.spec.skills[${i}]`);
    nonEmpty(skill.ref, `$.spec.skills[${i}].ref`);
  }
  const session = s.session;
  if (!isObject(session)) fail('invalid_session');
  keys(session, ['invocation', 'followUps', 'binding'], '$.spec.session');
  if (
    session.invocation !== 'fresh_per_invocation' ||
    session.followUps !== 'queued' ||
    session.binding !== 'reusable'
  )
    fail('invalid_session');
  const memory = s.memory;
  if (!isObject(memory)) fail('invalid_memory');
  keys(memory, ['policy', 'proposalLimit'], '$.spec.memory');
  if (
    memory.policy !== 'workspace_snapshot' ||
    typeof memory.proposalLimit !== 'number' ||
    !Number.isInteger(memory.proposalLimit) ||
    memory.proposalLimit < 0 ||
    memory.proposalLimit > MAX_COLLECTION_SIZE
  )
    fail('invalid_memory');
  const permissions = s.permissions;
  if (!isObject(permissions)) fail('invalid_permissions');
  keys(permissions, ['network', 'filesystem'], '$.spec.permissions');
  if (
    !['none', 'read_only'].includes(String(permissions.network)) ||
    !['none', 'workspace_read'].includes(String(permissions.filesystem))
  )
    fail('invalid_permissions');
  const completion = s.completion;
  if (!isObject(completion)) fail('invalid_completion', '$.spec.completion');
  keys(completion, ['type', 'command'], '$.spec.completion');
  if (completion.type !== 'executable')
    fail('invalid_completion', '$.spec.completion.type');
  if (typeof completion.command !== 'string' || !completion.command.trim())
    fail('invalid_completion', '$.spec.completion.command');
  const packageValue: any = {
    apiVersion: raw.apiVersion,
    kind: raw.kind,
    metadata: { name },
    spec: {
      description: nonEmpty(s.description, '$.spec.description'),
      instructions: nonEmpty(s.instructions, '$.spec.instructions'),
      runtime: {
        provider: runtime.provider,
        modelPolicyRef: runtime.modelPolicyRef,
        mode: runtime.mode,
      },
      tools,
      skills,
      input: { schema: js, prompt },
      session,
      memory,
      permissions,
      completion,
    },
  };
  scanSecrets(packageValue);
  const normalized = freeze(packageValue);
  const canonicalJson = canonical(normalized);
  return {
    package: normalized,
    canonicalJson,
    fingerprint: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`,
    normalizedName,
    compiler: Object.freeze({
      patternDialect: MANAGED_PATTERN_DIALECT,
      patternCompilerVersion: MANAGED_PATTERN_COMPILER_VERSION,
    }),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/** Stable JSON used when a managed package is rehydrated from JSONB. */
export function canonicalizeManagedAgentJson(value: unknown): string {
  return canonical(value);
}

export function rehydrateManagedAgentPackage(
  value: ManagedAgentPackage,
): ManagedAgentPackage {
  return freeze(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as any)) freeze(v);
  }
  return value;
}
