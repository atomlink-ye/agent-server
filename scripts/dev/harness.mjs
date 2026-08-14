import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const DEV_PROFILES_PATH = resolve(
  repositoryRoot,
  'config/dev-profiles.yaml',
);
const DEFAULT_PROFILE = 'core';
const OVERRIDABLE_FIELDS = ['provider', 'model'];

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}

export function loadProfiles(filePath = DEV_PROFILES_PATH) {
  const document = assertObject(
    parseYaml(readFileSync(filePath, 'utf8')),
    'development profile document',
  );
  if (document.version !== 1) {
    throw new Error('development profile version must be 1');
  }
  const profiles = assertObject(document.profiles, 'profiles');
  if (!Object.keys(profiles).length) {
    throw new Error('profiles must not be empty');
  }
  for (const [name, profile] of Object.entries(profiles)) {
    assertObject(profile, `profile ${name}`);
  }
  return profiles;
}

function mergeProfile(base, override) {
  const merged = { ...base, ...override };
  if (base.compose || override.compose) {
    merged.compose = {
      ...(base.compose ?? {}),
      ...(override.compose ?? {}),
    };
  }
  if (base.runtime || override.runtime) {
    merged.runtime = {
      ...(base.runtime ?? {}),
      ...(override.runtime ?? {}),
    };
  }
  return merged;
}

function resolveProfileDefinition(profiles, name, trail = []) {
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`unknown development profile: ${name}`);
  }
  if (trail.includes(name)) {
    throw new Error(
      `cyclic development profile inheritance: ${[...trail, name].join(' -> ')}`,
    );
  }
  const parentName = profile.extends;
  const parent = parentName
    ? resolveProfileDefinition(profiles, parentName, [...trail, name])
    : {};
  const resolved = mergeProfile(parent, profile);
  delete resolved.extends;
  if (!resolved.compose?.files || !resolved.services) {
    throw new Error(`profile ${name} must define compose files and services`);
  }
  return resolved;
}

function valueFromEnvironment(environment, name) {
  const value = environment[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeResolverArguments(profileOrOptions, maybeOptions) {
  if (typeof profileOrOptions === 'string') {
    return { ...(maybeOptions ?? {}), profileName: profileOrOptions };
  }
  return profileOrOptions ?? {};
}

/** Resolve one fixed development profile and its two supported overrides. */
export function resolveProfile(profileOrOptions, maybeOptions) {
  const options = normalizeResolverArguments(profileOrOptions, maybeOptions);
  const environment = options.environment ?? process.env;
  const cli = options.cli ?? {};
  const profileName =
    cli.profile ??
    options.profileName ??
    valueFromEnvironment(environment, 'DEV_PROFILE') ??
    DEFAULT_PROFILE;
  const profiles =
    options.profiles ?? loadProfiles(options.filePath ?? DEV_PROFILES_PATH);
  const definition = resolveProfileDefinition(profiles, profileName);
  const sources = {};
  for (const key of Object.keys(definition)) {
    if (key === 'compose') {
      sources['compose.files'] = 'profile';
    } else if (key === 'runtime') {
      for (const runtimeKey of Object.keys(definition.runtime ?? {})) {
        sources[`runtime.${runtimeKey}`] = 'profile';
      }
    } else {
      sources[key] = 'profile';
    }
  }

  for (const [field, environmentName] of [
    ['adapter', 'RUNTIME_ADAPTER'],
    ['provider', 'PASEO_PROVIDER'],
    ['model', 'PASEO_MODEL'],
  ]) {
    const environmentValue = valueFromEnvironment(environment, environmentName);
    if (environmentValue) {
      definition.runtime ??= {};
      definition.runtime[field] = environmentValue;
      sources[`runtime.${field}`] = 'environment';
    }
  }
  for (const field of OVERRIDABLE_FIELDS) {
    const cliValue = typeof cli[field] === 'string' ? cli[field].trim() : '';
    if (cliValue) {
      definition.runtime ??= {};
      definition.runtime[field] = cliValue;
      sources[`runtime.${field}`] = 'cli';
    }
  }

  return {
    name: profileName,
    ...definition,
    sources,
    profileSource: cli.profile
      ? 'cli'
      : options.profileName
        ? 'argument'
        : valueFromEnvironment(environment, 'DEV_PROFILE')
          ? 'environment'
          : 'default',
  };
}

export const loadProfileConfig = loadProfiles;
export const resolveDevelopmentProfile = resolveProfile;

function parseArguments(argumentsList) {
  const cli = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith('--')) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    let value = equals === -1 ? undefined : argument.slice(equals + 1);
    if (!['--profile', '--provider', '--model'].includes(flag)) {
      throw new Error(`unknown flag: ${flag}`);
    }
    if (value === undefined) {
      value = argumentsList[++index];
      if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value`);
      }
    }
    value = value.trim();
    if (!value) throw new Error(`${flag} requires a value`);
    cli[flag.slice(2)] = value;
  }
  return cli;
}

function explain(profile, environment = process.env) {
  const line = (key, value, source) => `${key}=${value} source=${source}`;
  const output = [
    line('profile', profile.name, profile.profileSource),
    line(
      'runtime.enabled',
      String(profile.runtime?.enabled),
      profile.sources['runtime.enabled'] ?? 'unset',
    ),
    line(
      'runtime.adapter',
      profile.runtime?.adapter ?? '<unset>',
      profile.sources['runtime.adapter'] ?? 'unset',
    ),
    line(
      'runtime.provider',
      profile.runtime?.provider ?? '<unset>',
      profile.sources['runtime.provider'] ?? 'unset',
    ),
    line(
      'runtime.model',
      profile.runtime?.model ?? '<unset>',
      profile.sources['runtime.model'] ?? 'unset',
    ),
    line(
      'provider_toolchain',
      profile.provider_toolchain ?? '<unset>',
      profile.sources.provider_toolchain ?? 'unset',
    ),
    line('services', profile.services.join(','), profile.sources.services),
    line(
      'compose.files',
      profile.compose.files.join(','),
      profile.sources['compose.files'],
    ),
  ];
  const key = environment.OPENCODE_GO_API_KEY;
  output.push(
    line(
      'OPENCODE_GO_API_KEY',
      key?.trim() ? '<redacted>' : '<absent>',
      key?.trim() ? 'environment' : 'unset',
    ),
  );
  return output.join('\n');
}

export function main(
  argumentsList = process.argv.slice(2),
  environment = process.env,
) {
  const [command = 'explain', ...flags] = argumentsList;
  if (command !== 'explain') throw new Error(`unknown command: ${command}`);
  const forwardedFlags = flags[0] === '--' ? flags.slice(1) : flags;
  const cli = parseArguments(forwardedFlags);
  return explain(resolveProfile({ cli, environment }), environment);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${main()}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
