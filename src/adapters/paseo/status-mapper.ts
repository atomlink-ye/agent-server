export type PaseoFinishStatus = 'idle' | 'error' | 'permission' | 'timeout';

export type RuntimeFinishStatus = 'idle' | 'failed' | 'timed_out';

export function hasPositiveModelUsage(
  usage:
    | {
        readonly inputTokens?: number;
        readonly outputTokens?: number;
      }
    | null
    | undefined,
): boolean {
  return (
    (typeof usage?.inputTokens === 'number' &&
      Number.isFinite(usage.inputTokens) &&
      usage.inputTokens > 0) ||
    (typeof usage?.outputTokens === 'number' &&
      Number.isFinite(usage.outputTokens) &&
      usage.outputTokens > 0)
  );
}

export function mapPaseoFinishStatus(
  status: PaseoFinishStatus,
): RuntimeFinishStatus {
  if (status === 'idle') {
    return 'idle';
  }
  if (status === 'timeout') {
    return 'timed_out';
  }
  return 'failed';
}
