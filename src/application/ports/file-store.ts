export interface FileStoreSnapshot {
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly memory: string;
  readonly manifest: string;
  readonly contentHash: string;
}

export interface FileStore {
  publish(snapshot: FileStoreSnapshot): Promise<void>;
}
