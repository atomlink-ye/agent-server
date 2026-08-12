import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const REAL_PROVIDER_DEFAULTS_PATH = resolve(
  ROOT,
  'config/real-provider-defaults.env',
);

const EXPECTED = [
  'PASEO_PROVIDER',
  'PASEO_MODEL',
  'PASEO_EXECUTION_TIMEOUT_MS',
  'PASEO_SESSION_RPC_TIMEOUT_MS',
  'PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS',
  'PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS',
  'PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
  'PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS',
  'PASEO_PROVIDER_REFRESH_TIMEOUT_MS',
  'PASEO_DAEMON_STARTUP_TIMEOUT_MS',
];

function parse(content) {
  const values = {};
  for (const [index, raw] of content.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(PASEO_[A-Z0-9_]+)=(.*)$/u.exec(line);
    if (!match || !EXPECTED.includes(match[1])) {
      throw new Error(`invalid real-provider defaults at line ${index + 1}`);
    }
    if (match[1] in values)
      throw new Error(`duplicate real-provider default: ${match[1]}`);
    values[match[1]] = match[2].trim();
  }
  const missing = EXPECTED.filter((name) => !values[name]);
  if (missing.length)
    throw new Error(`missing real-provider defaults: ${missing.join(', ')}`);
  for (const name of EXPECTED.slice(2)) {
    if (
      !/^\d+$/u.test(values[name]) ||
      Number(values[name]) <= 0 ||
      !Number.isSafeInteger(Number(values[name]))
    ) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  if (!/^[a-z0-9-]+$/u.test(values.PASEO_PROVIDER)) {
    throw new Error('PASEO_PROVIDER must be a simple provider identifier');
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(values.PASEO_MODEL)) {
    throw new Error('PASEO_MODEL must be a simple model identifier');
  }
  return values;
}

export function loadRealProviderDefaults(environment = process.env) {
  const configured = parse(readFileSync(REAL_PROVIDER_DEFAULTS_PATH, 'utf8'));
  return Object.fromEntries(
    EXPECTED.map((name) => [
      name,
      environment[name]?.trim() || configured[name],
    ]),
  );
}

export function checkRealProviderDefaults() {
  return parse(readFileSync(REAL_PROVIDER_DEFAULTS_PATH, 'utf8'));
}

export const realProviderDefaultNames = EXPECTED;
