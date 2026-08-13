import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

async function findInPath(command) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export async function resolveProviderBinary(provider, envName = `${provider.toUpperCase()}_BIN`) {
  const explicit = process.env[envName];
  if (explicit) {
    try { await access(explicit, constants.X_OK); return explicit; } catch {
      throw new Error(`provider_environment_invalid: ${provider} not found in PATH`);
    }
  }
  const binary = await findInPath(provider);
  if (!binary) throw new Error(`provider_environment_invalid: ${provider} not found in PATH`);
  try { await access(binary, constants.X_OK); return binary; } catch {
    throw new Error(`provider_environment_invalid: ${provider} not found in PATH`);
  }
}
