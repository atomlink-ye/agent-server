import type { TeamRunStatus } from '../../domain/teams/team-run.js';

export function revokeForTerminalTeamRun(input: {
  readonly teamRunId: string;
  readonly status: TeamRunStatus | null | undefined;
  readonly revokeForTeamRun: (teamRunId: string) => void;
}): void {
  if (input.status === 'succeeded' || input.status === 'failed')
    input.revokeForTeamRun(input.teamRunId);
}

export function revokeForRecoveredTeamRuns(
  recovered: ReadonlyArray<{ readonly teamRunId: string }>,
  revokeForTeamRun: (teamRunId: string) => void,
): void {
  for (const item of recovered) revokeForTeamRun(item.teamRunId);
}
