export type PaseoFinishStatus = 'idle' | 'error' | 'permission' | 'timeout';

export type RuntimeFinishStatus = 'succeeded' | 'failed' | 'timed_out';

export function mapPaseoFinishStatus(
  status: PaseoFinishStatus,
): RuntimeFinishStatus {
  if (status === 'idle') {
    return 'succeeded';
  }
  if (status === 'timeout') {
    return 'timed_out';
  }
  return 'failed';
}
