import { createHash, randomUUID } from 'node:crypto';

export const MAX_MEMORY_CONTENT_BYTES = 64 * 1024;
export const MAX_MEMORY_PATH_LENGTH = 512;

export class InvalidMemoryPathError extends Error {
  public readonly code = 'invalid_memory_path';
  public constructor() {
    super('The memory path must be a normalized relative POSIX path.');
  }
}
export class InvalidMemoryContentError extends Error {
  public readonly code = 'invalid_memory_content';
  public constructor() {
    super('Memory content must be non-empty UTF-8 text no larger than 64 KiB.');
  }
}
export class MemoryPathConflictError extends Error {
  public readonly code = 'memory_path_conflict';
  public constructor() {
    super('A memory with this path already exists in the store.');
  }
}

export interface MemoryApiPrincipalScope {
  readonly tenantId: string;
  readonly principalType: string;
  readonly principalId: string;
}
export interface MemoryApiOwnerScope extends MemoryApiPrincipalScope {
  readonly workspaceId: string;
}

export interface MemoryStore {
  readonly id: string;
  readonly owner: MemoryApiOwnerScope;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface MemoryVersion {
  readonly id: string;
  readonly memoryId: string;
  readonly version: number;
  readonly content: string;
  readonly contentSha256: string;
  readonly contentSizeBytes: number;
  readonly operation: 'created' | 'modified';
  readonly previousVersionId: string | null;
  readonly createdAt: string;
}
export interface Memory {
  readonly id: string;
  readonly storeId: string;
  readonly path: string;
  readonly current: MemoryVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function normalizeMemoryPath(path: string): string {
  if (
    path.length === 0 ||
    path.length > MAX_MEMORY_PATH_LENGTH ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/')
  )
    throw new InvalidMemoryPathError();
  const segments = path.split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  )
    throw new InvalidMemoryPathError();
  return segments.join('/');
}

export function validateMemoryContent(content: string): string {
  const size = Buffer.byteLength(content, 'utf8');
  if (
    size === 0 ||
    size > MAX_MEMORY_CONTENT_BYTES ||
    content.includes('\0') ||
    hasUnpairedSurrogate(content)
  )
    throw new InvalidMemoryContentError();
  return content;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
export function contentSizeBytes(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}
export function newMemoryId(): string {
  return randomUUID();
}
export function newMemoryVersionId(): string {
  return randomUUID();
}
