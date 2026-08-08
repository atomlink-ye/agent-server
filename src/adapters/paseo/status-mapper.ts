export type PaseoFinishStatus = 'idle' | 'error' | 'permission' | 'timeout';

export type RuntimeFinishStatus = 'succeeded' | 'failed' | 'timed_out';

const CLAUDE_AUTHENTICATION_SENTINEL = 'Not logged in · Please run /login';

export function isClaudeAuthenticationFailure(input: {
  readonly provider: string;
  readonly status: PaseoFinishStatus;
  readonly error: string | null;
  readonly lastMessage: string | null;
}): boolean {
  return (
    input.provider === 'claude' &&
    input.status === 'idle' &&
    input.error === null &&
    input.lastMessage?.trim() === CLAUDE_AUTHENTICATION_SENTINEL
  );
}

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
