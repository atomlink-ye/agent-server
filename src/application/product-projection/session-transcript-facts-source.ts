import type { ExecutionRunFact } from '../ports/execution-fact-query.js';

/**
 * The ordered run_events produced by ONE agent identity within one WorkRun,
 * plus the Runs that produced them. "An agent was active" is the display
 * unit; Team membership and roles are optional extra structure layered on
 * top, not a precondition for a stream to exist.
 */
export interface AgentActivityStreamFact {
  readonly name: string;
  readonly role: string | null;
  readonly status: string;
  readonly statusBasis: 'team_member_run' | 'agent_runs';
  readonly sourceRefs: {
    readonly teamMemberRunId?: string;
    readonly taskId?: string;
  };
  readonly runs: readonly ExecutionRunFact[];
}

export interface ProductSessionTranscriptFactsQuery {
  listByRootTask(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly rootTaskId: string;
  }): Promise<readonly AgentActivityStreamFact[]>;
}
