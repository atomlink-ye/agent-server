import type {
  Memory,
  MemoryStore,
} from '../../domain/memory-api/memory-api.js';

export interface WorkspaceResource {
  readonly id: string;
  readonly name: string;
}
export interface PublishedResource {
  readonly definitionId: string;
  readonly versionId: string;
  readonly fingerprint?: string;
  readonly outcome?: 'created' | 'converged' | 'replayed';
  readonly status?: 'draft' | 'published';
}
export interface ValidationResult {
  readonly fingerprint: string;
}
export interface InvokedTeamTask {
  readonly taskId: string;
  readonly status: 'queued';
}
export interface ProjectTask {
  readonly taskId: string;
  readonly status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';
  readonly invokable: {
    readonly kind: 'agent' | 'team';
    readonly versionId: string;
  };
  readonly rootTaskId: string;
  readonly latestRunId: string | null;
}
export interface ProjectTaskTree {
  readonly rootTaskId: string;
  readonly tasks: readonly ProjectTask[];
}

export interface ProjectControlPlane {
  invokeTeam(input: {
    readonly versionId: string;
    readonly input: string;
    readonly idempotencyKey: string;
  }): Promise<InvokedTeamTask>;
  getTask(taskId: string, signal?: AbortSignal): Promise<ProjectTask>;
  getTaskTree(taskId: string, signal?: AbortSignal): Promise<ProjectTaskTree>;
  getWorkspace(): Promise<WorkspaceResource | null>;
  validateEnvironment(source: string): Promise<ValidationResult>;
  importEnvironment(
    source: string,
    idempotencyKey: string,
  ): Promise<PublishedResource>;
  publishEnvironment(
    versionId: string,
    idempotencyKey: string,
  ): Promise<PublishedResource>;
  validateWorker(source: string): Promise<ValidationResult>;
  importWorker(
    source: string,
    idempotencyKey: string,
  ): Promise<PublishedResource>;
  publishWorker(
    versionId: string,
    idempotencyKey: string,
  ): Promise<PublishedResource>;
  validateTeam(source: string): Promise<ValidationResult>;
  importTeam(
    source: string,
    idempotencyKey: string,
  ): Promise<PublishedResource>;
  publishTeam(
    versionId: string,
    idempotencyKey: string,
  ): Promise<PublishedResource>;
  listMemoryStores(workspaceId: string): Promise<readonly MemoryStore[]>;
  getMemoryStore(id: string): Promise<MemoryStore | null>;
  createMemoryStore(input: {
    readonly workspaceId: string;
    readonly name: string;
    readonly description?: string;
  }): Promise<MemoryStore>;
  listMemories(storeId: string): Promise<readonly Memory[]>;
  getMemory(storeId: string, memoryId: string): Promise<Memory | null>;
  createMemory(input: {
    readonly storeId: string;
    readonly path: string;
    readonly content: string;
  }): Promise<Memory>;
  updateMemory(input: {
    readonly storeId: string;
    readonly memoryId: string;
    readonly content: string;
    readonly expectedSha256: string;
  }): Promise<Memory>;
}
