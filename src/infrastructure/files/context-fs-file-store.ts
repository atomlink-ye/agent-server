import type {
  FileStore,
  FileStoreSnapshot,
  ReadVerifiedFileStoreInput,
} from '../../application/ports/file-store.js';
import type { LogicalFileStore } from '../../application/ports/logical-file-store.js';
import { workspaceContextScope } from '../../domain/context/context-fs.js';

/**
 * ManagedMemory compatibility adapter backed by canonical ContextFS instead of
 * a provider/local cwd filesystem.
 */
export class ContextFsFileStore implements FileStore {
  public constructor(private readonly files: LogicalFileStore) {}

  public async publish(snapshot: FileStoreSnapshot): Promise<void> {
    const scope = workspaceContextScope({
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
    });
    const root = snapshotRoot(snapshot.snapshotId);
    await this.files.write({
      scope,
      path: `${root}/MEMORY.md`,
      content: snapshot.memory,
    });
    await this.files.write({
      scope,
      path: `${root}/manifest.json`,
      content: snapshot.manifest,
    });
  }

  public async readVerified(
    input: ReadVerifiedFileStoreInput,
  ): Promise<string> {
    const scope = workspaceContextScope({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
    });
    const entry = await this.files.read(
      scope,
      `${snapshotRoot(input.snapshotId)}/MEMORY.md`,
    );
    if (!entry || entry.contentSha256 !== input.expectedContentHash) {
      throw new Error('Managed Memory ContextFS projection hash mismatch.');
    }
    return entry.content;
  }
}

function snapshotRoot(snapshotId: string): string {
  const clean = snapshotId.trim();
  if (!clean) throw new Error('Managed Memory snapshot id is required.');
  return `memory/snapshots/${encodeURIComponent(clean)}`;
}
