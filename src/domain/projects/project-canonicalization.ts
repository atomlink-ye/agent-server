import { createHash } from 'node:crypto';
import type { AgentProjectManifest, SourceTuple } from './agent-project.js';

export type Sha256Fingerprint = `sha256:${string}`;

export function canonicalizeProjectValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalizeProjectValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeProjectValue(record[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalizeManifest(manifest: AgentProjectManifest): string {
  return canonicalizeProjectValue(manifest);
}

export function fingerprintProject(
  manifest: AgentProjectManifest,
  tuples: readonly SourceTuple[],
): Sha256Fingerprint {
  const input = `${canonicalizeManifest(manifest)}\n${[...tuples]
    .sort((a, b) => {
      const left = [a.type, a.name, a.path, a.digest].join('\0');
      const right = [b.type, b.name, b.path, b.digest].join('\0');
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map((tuple) => canonicalizeProjectValue(tuple))
    .join('\n')}`;
  return `sha256:${createHash('sha256').update(input, 'utf8').digest('hex')}`;
}
