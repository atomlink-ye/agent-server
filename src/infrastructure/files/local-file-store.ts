import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  FileStore,
  FileStoreSnapshot,
  ReadVerifiedFileStoreInput,
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
    const target = join(
      this.root,
      snapshot.tenantId,
      snapshot.workspaceId,
      snapshot.snapshotId,
    );
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
      await mkdir(join(this.root, snapshot.tenantId, snapshot.workspaceId), {
        recursive: true,
      });
      await rm(target, { recursive: true, force: true });
      await rename(temp, target);
      await writeFile(
        join(
          this.root,
          snapshot.tenantId,
          snapshot.workspaceId,
          'latest-ready',
        ),
        snapshot.snapshotId,
        'utf8',
      );
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
  }

  public async readVerified(
    input: ReadVerifiedFileStoreInput,
  ): Promise<string> {
    const directory = join(
      this.root,
      input.tenantId,
      input.workspaceId,
      input.snapshotId,
    );
    try {
      const [memory, manifestText] = await Promise.all([
        readFile(join(directory, 'MEMORY.md'), 'utf8'),
        readFile(join(directory, 'manifest.json'), 'utf8'),
      ]);
      const manifest = JSON.parse(manifestText) as { content_hash?: string };
      const actualHash = createHash('sha256').update(memory).digest('hex');
      if (
        actualHash !== input.expectedContentHash ||
        actualHash !== manifest.content_hash
      ) {
        throw new Error('Memory snapshot verification failed');
      }
      return memory;
    } catch {
      throw new Error('Memory snapshot verification failed');
    }
  }
}
