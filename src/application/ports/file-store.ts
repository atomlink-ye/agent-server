export interface FileStoreSnapshot {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly memory: string;
  readonly manifest: string;
  readonly contentHash: string;
}

export interface ReadVerifiedFileStoreInput {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly expectedContentHash: string;
}

export interface FileStore {
  publish(snapshot: FileStoreSnapshot): Promise<void>;
  readVerified(input: ReadVerifiedFileStoreInput): Promise<string>;
}
