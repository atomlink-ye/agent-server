export interface WorkMemoryVersion {
  readonly versionId: string;
  readonly memoryId: string;
  readonly storeId: string;
  readonly path: string;
  readonly content: string;
  readonly contentSha256: string;
}

export interface MemoryVersionReadScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

/** Exact immutable MemoryVersion lookup used by Work Definition resolution. */
export interface MemoryVersionReadApi {
  findVersion(
    versionId: string,
    scope: MemoryVersionReadScope,
  ): Promise<WorkMemoryVersion | null>;
}
