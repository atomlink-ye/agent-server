import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  FileStore,
  FileStoreSnapshot,
} from '../../application/ports/file-store.js';

export class LocalFileStore implements FileStore {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public async publish(snapshot: FileStoreSnapshot): Promise<void> {
    const actualHash = createHash('sha256')
      .update(snapshot.memory)
      .digest('hex');
    if (actualHash !== snapshot.contentHash)
      throw new Error('Memory snapshot hash verification failed');
    const temp = join(this.root, `.tmp-${snapshot.snapshotId}`);
    const target = join(this.root, snapshot.workspaceId, snapshot.snapshotId);
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    try {
      await writeFile(join(temp, 'MEMORY.md'), snapshot.memory, 'utf8');
      await writeFile(join(temp, 'manifest.json'), snapshot.manifest, 'utf8');
      const written = await readFile(join(temp, 'MEMORY.md'), 'utf8');
      if (
        createHash('sha256').update(written).digest('hex') !==
        snapshot.contentHash
      )
        throw new Error('Memory snapshot hash verification failed');
      await mkdir(join(this.root, snapshot.workspaceId), { recursive: true });
      await rm(target, { recursive: true, force: true });
      await rename(temp, target);
      await writeFile(
        join(this.root, snapshot.workspaceId, 'latest-ready'),
        snapshot.snapshotId,
        'utf8',
      );
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
  }
}
