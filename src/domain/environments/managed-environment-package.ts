import { createHash } from 'node:crypto';
import {
  parseManagedAgentYaml,
  ManagedAgentYamlError,
  MAX_SOURCE_BYTES,
  MAX_SCALAR_LENGTH,
} from '../agents/managed-agent-yaml.js';
import { normalizeManagedAgentName } from '../agents/managed-agent-owner.js';

export const MANAGED_ENVIRONMENT_PROVIDERS = [
  'opencode',
  'claude',
  'codex',
] as const;
export type ManagedEnvironmentProvider =
  (typeof MANAGED_ENVIRONMENT_PROVIDERS)[number];
export const isManagedEnvironmentProvider = (
  v: unknown,
): v is ManagedEnvironmentProvider =>
  typeof v === 'string' &&
  (MANAGED_ENVIRONMENT_PROVIDERS as readonly string[]).includes(v);

export interface ManagedEnvironmentPackage {
  readonly apiVersion: 'agent-server/v1alpha1';
  readonly kind: 'ManagedEnvironment';
  readonly metadata: { readonly name: string };
  readonly spec: {
    readonly adapter: 'paseo';
    readonly provider: ManagedEnvironmentProvider;
    readonly modelPolicyRef: 'free-only';
    readonly runtimeCellPolicy: 'per_runtime_session';
  };
}
export interface ParsedManagedEnvironmentPackage {
  readonly package: ManagedEnvironmentPackage;
  readonly canonicalJson: string;
  readonly fingerprint: string;
  readonly normalizedName: string;
}
export class ManagedEnvironmentPackageError extends Error {
  constructor(
    readonly code: string,
    readonly path = '$',
  ) {
    super(code);
    this.name = 'ManagedEnvironmentPackageError';
  }
}
const fail = (code: string, path?: string): never => {
  throw new ManagedEnvironmentPackageError(code, path);
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const check = (v: Record<string, unknown>, allowed: string[], path: string) => {
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) fail('unknown_field', `${path}.__unknown__`);
};
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : obj(v)
      ? `{${Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',')}}`
      : JSON.stringify(v);
export function parseManagedEnvironmentPackage(
  source: string,
): ParsedManagedEnvironmentPackage {
  let raw: any;
  if (
    typeof source !== 'string' ||
    Buffer.byteLength(source) > MAX_SOURCE_BYTES
  )
    fail('source_too_large');
  try {
    raw = parseManagedAgentYaml(source);
  } catch (e) {
    if (e instanceof ManagedAgentYamlError) fail(e.code, e.path);
    fail('yaml_invalid');
  }
  if (!obj(raw)) fail('invalid_root');
  check(raw, ['apiVersion', 'kind', 'metadata', 'spec'], '$');
  if (raw.apiVersion !== 'agent-server/v1alpha1')
    fail('invalid_api_version', '$.apiVersion');
  if (raw.kind !== 'ManagedEnvironment') fail('invalid_kind', '$.kind');
  if (!obj(raw.metadata)) fail('invalid_metadata', '$.metadata');
  check(raw.metadata, ['name'], '$.metadata');
  const name = raw.metadata.name;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > MAX_SCALAR_LENGTH
  )
    fail('invalid_name', '$.metadata.name');
  const normalizedName = normalizeManagedAgentName(name);
  if (!normalizedName) fail('invalid_name', '$.metadata.name');
  if (!obj(raw.spec)) fail('invalid_spec', '$.spec');
  check(
    raw.spec,
    ['adapter', 'provider', 'modelPolicyRef', 'runtimeCellPolicy'],
    '$.spec',
  );
  if (raw.spec.adapter !== 'paseo') fail('invalid_adapter', '$.spec.adapter');
  if (!isManagedEnvironmentProvider(raw.spec.provider))
    fail('invalid_provider', '$.spec.provider');
  if (raw.spec.modelPolicyRef !== 'free-only')
    fail('model_policy_not_allowed', '$.spec.modelPolicyRef');
  if (raw.spec.runtimeCellPolicy !== 'per_runtime_session')
    fail('invalid_runtime_cell_policy', '$.spec.runtimeCellPolicy');
  const value = {
    apiVersion: raw.apiVersion,
    kind: raw.kind,
    metadata: { name },
    spec: {
      adapter: raw.spec.adapter,
      provider: raw.spec.provider,
      modelPolicyRef: raw.spec.modelPolicyRef,
      runtimeCellPolicy: raw.spec.runtimeCellPolicy,
    },
  } as ManagedEnvironmentPackage;
  const canonicalJson = canonical(value);
  return {
    package: Object.freeze(value),
    canonicalJson,
    fingerprint: `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`,
    normalizedName,
  };
}
export function canonicalizeManagedEnvironmentJson(v: unknown) {
  return canonical(v);
}
