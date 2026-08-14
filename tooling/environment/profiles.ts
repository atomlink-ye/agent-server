import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import type {
  ComposeProfile,
  LocalEnvironmentName,
  LocalEnvironmentProfile,
  RuntimeOverrides,
  RuntimeProfile,
} from './types.js';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const LOCAL_ENVIRONMENTS_PATH = resolve(
  repositoryRoot,
  'config/local-environments.yaml',
);

const supportedProfiles = new Set<LocalEnvironmentName>([
  'in-process',
  'postgres',
  'core',
  'runtime',
  'full',
]);

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): RawRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as RawRecord;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return [...value];
}

function mergeRaw(parent: RawRecord, child: RawRecord): RawRecord {
  return {
    ...parent,
    ...child,
    ...(parent.runtime || child.runtime
      ? {
          runtime: {
            ...(parent.runtime ? asRecord(parent.runtime, 'runtime') : {}),
            ...(child.runtime ? asRecord(child.runtime, 'runtime') : {}),
          },
        }
      : {}),
    ...(parent.compose || child.compose
      ? {
          compose: {
            ...(parent.compose ? asRecord(parent.compose, 'compose') : {}),
            ...(child.compose ? asRecord(child.compose, 'compose') : {}),
          },
        }
      : {}),
  };
}

function resolveRaw(
  profiles: RawRecord,
  name: string,
  trail: readonly string[] = [],
): RawRecord {
  const value = profiles[name];
  if (!value) throw new Error(`unknown local environment profile: ${name}`);
  if (trail.includes(name)) {
    throw new Error(
      `cyclic local environment inheritance: ${[...trail, name].join(' -> ')}`,
    );
  }
  const current = asRecord(value, `profile ${name}`);
  const parentName = current.extends;
  const parent =
    typeof parentName === 'string'
      ? resolveRaw(profiles, parentName, [...trail, name])
      : {};
  const merged = mergeRaw(parent, current);
  delete merged.extends;
  return merged;
}

function normalizeRuntime(value: unknown, name: string): RuntimeProfile {
  const runtime = asRecord(value, `profile ${name}.runtime`);
  if (typeof runtime.enabled !== 'boolean') {
    throw new Error(`profile ${name}.runtime.enabled must be boolean`);
  }
  if (typeof runtime.adapter !== 'string' || !runtime.adapter.trim()) {
    throw new Error(`profile ${name}.runtime.adapter must be a string`);
  }
  return {
    enabled: runtime.enabled,
    adapter: runtime.adapter,
    ...(typeof runtime.provider === 'string'
      ? { provider: runtime.provider }
      : {}),
    ...(typeof runtime.model === 'string' ? { model: runtime.model } : {}),
  };
}

function normalizeCompose(value: unknown, name: string): ComposeProfile {
  const compose = asRecord(value, `profile ${name}.compose`);
  if (compose.transport !== 'raw' && compose.transport !== 'repository') {
    throw new Error(
      `profile ${name}.compose.transport must be raw or repository`,
    );
  }
  return {
    transport: compose.transport,
    files: asStringArray(compose.files, `profile ${name}.compose.files`),
  };
}

export async function loadLocalEnvironmentProfiles(
  filePath = LOCAL_ENVIRONMENTS_PATH,
): Promise<ReadonlyMap<LocalEnvironmentName, LocalEnvironmentProfile>> {
  const document = asRecord(
    parseYaml(await readFile(filePath, 'utf8')),
    'local environment document',
  );
  if (document.version !== 1) {
    throw new Error('local environment document version must be 1');
  }
  const profiles = asRecord(document.profiles, 'profiles');
  const result = new Map<LocalEnvironmentName, LocalEnvironmentProfile>();
  for (const name of supportedProfiles) {
    const raw = resolveRaw(profiles, name);
    const providerToolchain = raw.provider_toolchain;
    if (providerToolchain !== 'disabled' && providerToolchain !== 'required') {
      throw new Error(
        `profile ${name}.provider_toolchain must be disabled or required`,
      );
    }
    result.set(name, {
      name,
      providerToolchain,
      services: asStringArray(raw.services, `profile ${name}.services`),
      runtime: normalizeRuntime(raw.runtime, name),
      compose: normalizeCompose(raw.compose, name),
    });
  }
  return result;
}

export async function resolveLocalEnvironment(
  name: LocalEnvironmentName,
  options: {
    readonly filePath?: string | undefined;
    readonly environment?: NodeJS.ProcessEnv | undefined;
    readonly overrides?: RuntimeOverrides | undefined;
  } = {},
): Promise<LocalEnvironmentProfile> {
  const profiles = await loadLocalEnvironmentProfiles(options.filePath);
  const profile = profiles.get(name);
  if (!profile) throw new Error(`unknown local environment profile: ${name}`);
  const environment = options.environment ?? process.env;
  const runtime: RuntimeProfile = {
    ...profile.runtime,
    ...(environment.RUNTIME_ADAPTER?.trim()
      ? { adapter: environment.RUNTIME_ADAPTER.trim() }
      : {}),
    ...(environment.PASEO_PROVIDER?.trim()
      ? { provider: environment.PASEO_PROVIDER.trim() }
      : {}),
    ...(environment.PASEO_MODEL?.trim()
      ? { model: environment.PASEO_MODEL.trim() }
      : {}),
    ...options.overrides,
  };
  return { ...profile, runtime };
}

export function parseLocalEnvironmentName(value: string): LocalEnvironmentName {
  if (!supportedProfiles.has(value as LocalEnvironmentName)) {
    throw new Error(`unknown local environment profile: ${value}`);
  }
  return value as LocalEnvironmentName;
}
