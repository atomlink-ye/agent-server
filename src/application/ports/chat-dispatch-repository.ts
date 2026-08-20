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

  markPublished(id: string, publishedAt: string): Promise<void>;
}
