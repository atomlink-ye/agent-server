import type { ExecutionRunFact } from '../ports/execution-fact-query.js';

export interface ProductSessionTranscriptMemberFact {
  readonly name: string;
  readonly role: string;
  readonly status: string;
  /** Internal grouping key; never copy this into a Product response. */
  readonly runtimeSessionId: string;
  readonly runs: readonly ExecutionRunFact[];
}

export interface ProductSessionTranscriptFactsQuery {
  listByRootTask(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly rootTaskId: string;
  }): Promise<readonly ProductSessionTranscriptMemberFact[]>;
}
