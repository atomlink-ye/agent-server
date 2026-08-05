import { createHash } from 'node:crypto';
import { stringify } from 'yaml';

export function canonicalizeYaml(value: unknown): string {
  return stringify(sortYamlValue(value), { lineWidth: 0 });
}

export function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function bareSha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortYamlValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortYamlValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort(compareStrings)
        .map((key) => [
          key,
          sortYamlValue((value as Record<string, unknown>)[key]),
        ]),
    );
  return value;
}
