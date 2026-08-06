import { describe, expect, it, vi } from 'vitest';
import {
  revokeForRecoveredTeamRuns,
  revokeForTerminalTeamRun,
} from './runtime-grant-lifecycle.js';

describe('runtime grant lifecycle wiring', () => {
  it.each(['succeeded', 'failed'] as const)(
    'revokes a %s TeamRun after terminal handling',
    (status) => {
      const revoke = vi.fn();
      revokeForTerminalTeamRun({
        teamRunId: 'team-1',
        status,
        revokeForTeamRun: revoke,
      });
      expect(revoke).toHaveBeenCalledWith('team-1');
    },
  );

  it.each(['active', 'waiting', null, undefined] as const)(
    'does not revoke a nonterminal or missing TeamRun (%s)',
    (status) => {
      const revoke = vi.fn();
      revokeForTerminalTeamRun({
        teamRunId: 'team-1',
        status,
        revokeForTeamRun: revoke,
      });
      expect(revoke).not.toHaveBeenCalled();
    },
  );

  it('revokes every recovered TeamRun', () => {
    const revoke = vi.fn();
    revokeForRecoveredTeamRuns(
      [{ teamRunId: 'team-1' }, { teamRunId: 'team-2' }],
      revoke,
    );
    expect(revoke.mock.calls).toEqual([['team-1'], ['team-2']]);
  });
});
