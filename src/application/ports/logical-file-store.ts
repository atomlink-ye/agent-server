import type { ContextScope } from '../../domain/context/context-fs.js';

export interface LogicalFileEntry {
  readonly id: string;
  readonly scope: ContextScope;
  readonly path: string;
  readonly currentVersion: number;
  readonly content: string;
  readonly contentSha256: string;
  readonly contentSizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LogicalFileStore {
  list(scope: ContextScope): Promise<readonly LogicalFileEntry[]>;
  read(scope: ContextScope, path: string): Promise<LogicalFileEntry | null>;
  write(input: {
    readonly scope: ContextScope;
    readonly path: string;
    readonly content: string;
  }): Promise<LogicalFileEntry>;
}
