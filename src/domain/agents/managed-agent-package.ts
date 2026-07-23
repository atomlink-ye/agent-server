import { createHash } from 'node:crypto';
import { parseAllDocuments } from 'yaml';

export const MAX_SOURCE_BYTES = 64 * 1024;
export const MAX_AST_NODES = 500;
export const MAX_AST_DEPTH = 24;
export const MAX_COLLECTION_SIZE = 64;
export const MAX_SCALAR_LENGTH = 16 * 1024;
export const MAX_SCHEMA_DEPTH = 8;
export const BUILT_IN_MODEL_POLICY_REFS = ['free-only'] as const;
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
export type JsonSchema = {
  readonly type:
    'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly enum?: readonly (string | number | boolean)[];
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly additionalProperties: false;
};
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

function astCheck(node: unknown, depth = 0, state = { nodes: 0 }): void {
  if (!node || typeof node !== 'object') return;
  if (++state.nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH)
    fail('complexity_limit');
  const n = node as Record<string, unknown>;
  if (
    'source' in n &&
    typeof n.source === 'string' &&
    n.source.length > MAX_SCALAR_LENGTH
  )
    fail('scalar_limit');
  if (typeof n.value === 'string' && n.value.length > MAX_SCALAR_LENGTH)
    fail('scalar_limit');
  if (n.type === 'ALIAS' || n.anchor || n.tag) fail('forbidden_yaml_feature');
  const items = Array.isArray(n.items) ? n.items : [];
  if (items.length > MAX_COLLECTION_SIZE) fail('collection_limit');
  for (const item of items) astCheck(item, depth + 1, state);
}

function plain(node: unknown, path = '$'): any {
  if (node === null || typeof node !== 'object') return node;
  const n = node as Record<string, unknown>;
  if (Array.isArray(node)) return node.map((v, i) => plain(v, `${path}[${i}]`));
  if (n.type === 'ALIAS' || n.anchor || n.tag)
    fail('forbidden_yaml_feature', path);
  if (Array.isArray(n.items)) {
    if (
      n.items.some(
        (entry: any) =>
          Array.isArray(entry) ||
          !entry ||
          typeof entry !== 'object' ||
          !('key' in entry),
      )
    )
      return n.items.map((v: any, i: number) => plain(v, `${path}[${i}]`));
    const out: Record<string, unknown> = {};
    for (const [index, pair] of (n.items as any[]).entries()) {
      const pairPath = `${path}[${index}]`;
      const key = plain(pair.key, pairPath);
      if (typeof key !== 'string') fail('invalid_key', path);
      if (key in out) fail('duplicate_key', `${path}.__duplicate__`);
      out[key] = plain(pair.value, pairPath);
    }
    return out;
  }
  return n.value;
}

function schema(
  value: any,
  path = '$.spec.input.schema',
  depth = 0,
): JsonSchema {
  if (!isObject(value) || depth > MAX_SCHEMA_DEPTH)
    fail('invalid_schema', path);
  keys(
    value,
    [
      'type',
      'required',
      'properties',
      'items',
      'enum',
      'min',
      'max',
      'pattern',
      'additionalProperties',
    ],
    path,
  );
  const type = value.type;
  if (
    !['object', 'string', 'number', 'integer', 'boolean', 'array'].includes(
      String(type),
    )
  )
    fail('invalid_schema', `${path}.type`);
  if (value.additionalProperties !== false)
    fail('invalid_schema', `${path}.additionalProperties`);
  if (
    value.min !== undefined &&
    (typeof value.min !== 'number' || !Number.isFinite(value.min))
  )
    fail('invalid_schema', `${path}.min`);
  if (
    value.max !== undefined &&
    (typeof value.max !== 'number' ||
      !Number.isFinite(value.max) ||
      (value.min !== undefined && value.max < value.min))
  )
    fail('invalid_schema', `${path}.max`);
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== 'string')
      fail('invalid_schema', `${path}.pattern`);
    try {
      new RegExp(value.pattern);
    } catch {
      fail('invalid_regex', `${path}.pattern`);
    }
  }
  if (
    value.enum !== undefined &&
    (!Array.isArray(value.enum) ||
      value.enum.some(
        (v: any) =>
          !['string', 'number', 'boolean'].includes(typeof v) ||
          (typeof v === 'number' && !Number.isFinite(v)),
      ))
  )
    fail('invalid_schema', `${path}.enum`);
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) ||
      value.required.some((v: any) => typeof v !== 'string'))
  )
    fail('invalid_schema', `${path}.required`);
  const props = value.properties;
  if (
    props !== undefined &&
    (!isObject(props) || Object.keys(props).length > MAX_COLLECTION_SIZE)
  )
    fail('invalid_schema', `${path}.properties`);
  if (type === 'object' && props) {
    for (const [k, v] of Object.entries(props))
      schema(v, `${path}.properties.${k}`, depth + 1);
    if (value.required && value.required.some((k: string) => !(k in props)))
      fail('invalid_schema', `${path}.required`);
  }
  if (type === 'array' && value.items !== undefined)
    schema(value.items, `${path}.items`, depth + 1);
  return value as JsonSchema;
}

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
    Object.entries(value).forEach(([k, v]) => scanSecrets(v, `${path}.${k}`));
}

export function parseManagedAgentPackage(
  source: string,
): ParsedManagedAgentPackage {
  if (
    typeof source !== 'string' ||
    Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES
  )
    fail('source_limit');
  if (/%YAML\s+1\.[01]|%TAG\s/i.test(source)) fail('forbidden_yaml_directive');
  let doc: any;
  try {
    const docs = parseAllDocuments(source, {
      version: '1.2',
      uniqueKeys: true,
      prettyErrors: false,
      maxAliasCount: 0,
    } as any);
    if (docs.length !== 1) fail('document_count');
    doc = docs[0];
    astCheck(doc.contents);
    if (doc.errors.length || doc.warnings.length) fail('yaml_invalid');
  } catch (e) {
    if (e instanceof ManagedAgentPackageError) throw e;
    fail('yaml_invalid');
  }
  const raw: any = plain(doc.contents);
  if (!isObject(raw)) fail('invalid_root');
  keys(raw, ['apiVersion', 'kind', 'metadata', 'spec'], '$');
  if (raw.apiVersion !== 'agent-server/v1alpha1')
    fail('invalid_api_version', '$.apiVersion');
  if (raw.kind !== 'ManagedAgent') fail('invalid_kind', '$.kind');
  const metadata = raw.metadata;
  if (!isObject(metadata)) fail('invalid_metadata', '$.metadata');
  keys(metadata, ['name'], '$.metadata');
  const name = nonEmpty(metadata.name, '$.metadata.name');
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
  const js = schema(input.schema);
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
  if (!isObject(completion)) fail('invalid_completion');
  keys(completion, ['type', 'command'], '$.spec.completion');
  if (
    completion.type !== 'executable' ||
    typeof completion.command !== 'string' ||
    !completion.command.trim()
  )
    fail('invalid_completion');
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
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as any)) freeze(v);
  }
  return value;
}
