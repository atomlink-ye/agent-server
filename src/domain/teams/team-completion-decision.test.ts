import { describe, expect, it } from 'vitest';

import { createTeamCompletionDecision } from './team-completion-decision.js';

const ownerScope = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account',
  principalId: 'svc_alpha',
} as const;

const baseDecision = {
  id: '00000000-0000-4000-8000-000000009001',
  ...ownerScope,
  teamRunId: '00000000-0000-4000-8000-000000009002',
  completionRequestedByRunId: '00000000-0000-4000-8000-000000009003',
  decidedBy: 'svc_reviewer',
  decidedAt: '2026-08-08T00:00:00.000Z',
  leadTurnCountAtDecision: 4,
} as const;

describe('team completion decision domain', () => {
  it('requires non-blank feedback for rejected completion', () => {
    expect(() =>
      createTeamCompletionDecision({
        ...baseDecision,
        decision: 'reject',
        feedback: '   ',
        targets: [
          {
            workItemId: '00000000-0000-4000-8000-000000009011',
            attemptNoAtDecision: 1,
          },
        ],
      }),
    ).toThrow(/feedback/i);
  });

  it('requires at least one target for rejected completion', () => {
    expect(() =>
      createTeamCompletionDecision({
        ...baseDecision,
        decision: 'reject',
        feedback: 'Please revise the implementation.',
        targets: [],
      }),
    ).toThrow(/target/i);
  });

  it('forbids feedback and targets for approved completion', () => {
    expect(() =>
      createTeamCompletionDecision({
        ...baseDecision,
        decision: 'approve',
        feedback: 'No further changes are needed.',
      }),
    ).toThrow(/feedback|targets/i);

    expect(() =>
      createTeamCompletionDecision({
        ...baseDecision,
        decision: 'approve',
        targets: [
          {
            workItemId: '00000000-0000-4000-8000-000000009012',
            attemptNoAtDecision: 1,
          },
        ],
      }),
    ).toThrow(/feedback|targets/i);
  });

  it('normalizes text and deeply freezes the decision snapshot', () => {
    const targets = [
      {
        workItemId: '00000000-0000-4000-8000-000000009013',
        attemptNoAtDecision: 2,
      },
    ];
    const decision = createTeamCompletionDecision({
      ...baseDecision,
      decision: 'reject',
      feedback: '  Please revise the implementation.  ',
      targets,
    });

    expect(decision.feedback).toBe('Please revise the implementation.');
    expect(decision.targets).toEqual(targets);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.targets)).toBe(true);
    expect(Object.isFrozen(decision.targets[0])).toBe(true);

    targets[0]!.attemptNoAtDecision = 99;
    expect(decision.targets[0]!.attemptNoAtDecision).toBe(2);
    expect(() => {
      (decision as { feedback: string | null }).feedback = 'mutated';
    }).toThrow();
  });
});
