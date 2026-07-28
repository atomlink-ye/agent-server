import { createHash } from 'node:crypto';

export type SkillDigestFile = Readonly<{
  path: string;
  bytes: Buffer;
}>;

export function digestSkillFiles(files: readonly SkillDigestFile[]): string {
  const hash = createHash('sha256');
  hash.update(Buffer.from('agent-server-skill-package-v1\0', 'utf8'));
  for (const file of [...files].sort((left, right) =>
    compareCodeUnits(left.path, right.path),
  )) {
    const path = Buffer.from(file.path, 'utf8');
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(path.byteLength), 0);
    hash.update(length);
    hash.update(path);
    length.writeBigUInt64BE(BigInt(file.bytes.byteLength), 0);
    hash.update(length);
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
