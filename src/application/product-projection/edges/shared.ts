import type { ProductTraceEdge } from '../../../contracts/product-projection/edges.js';

export interface EdgeProjection<T extends ProductTraceEdge = ProductTraceEdge> {
  readonly edges: readonly T[];
  /** Stable source-row keys used for source/response exact-set checks. */
  readonly sourceRowKeys: readonly string[];
}

export function messageRefs(teamRunId: string, teamMessageId: string) {
  return { team_run_id: teamRunId, team_message_id: teamMessageId };
}

export function teamRunRefs(teamRunId: string) {
  return { team_run_id: teamRunId };
}

export function attemptRefs(teamRunId: string, taskId: string) {
  return { team_run_id: teamRunId, task_id: taskId };
}
