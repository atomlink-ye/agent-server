export interface ChatDispatch {
  readonly id: string;
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly conversationId: string;
  readonly throughSequence: number;
  readonly dedupeKey: string;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface ChatDispatchRepository {
  enqueue(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly conversationId: string;
    readonly throughSequence: number;
    readonly dedupeKey: string;
  }): Promise<{ readonly enqueued: boolean }>;

  listPending(limit: number): Promise<readonly ChatDispatch[]>;

  claimNext(workerId: string, leaseMs: number): Promise<ChatDispatch | null>;

  completeClaim(input: {
    readonly id: string;
    readonly workerId: string;
    readonly publishedAt: string;
  }): Promise<boolean>;

  markPublished(id: string, publishedAt: string): Promise<void>;
}
