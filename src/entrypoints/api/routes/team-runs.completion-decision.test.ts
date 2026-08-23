import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { TeamExecutionError } from '../../../application/ports/team-execution-repository.js';
import { HttpError } from '../../../contracts/http.js';
import { TeamRunResponseSchema } from '../../../contracts/teams.js';
import type { ApiEnvironment } from '../http-types.js';
import { registerTeamRunRoutes } from './team-runs.js';

const config = {
  serviceAccounts: [
    {
      serviceAccountId: 'svc_decision',
      token: 'decision-token',
      tenantId: 'tenant-decision',
      workspaceId: 'workspace-decision',
      policyVersion: 'policy-decision',
      disabled: false,
    },
  ],
} as never;
const team = {
  id: '00000000-0000-4000-8000-000000000201',
  rootTaskId: '00000000-0000-4000-8000-000000000202',
  rootRunId: '00000000-0000-4000-8000-000000000203',
  teamVersionId: '00000000-0000-4000-8000-000000000204',
  environmentVersionId: '00000000-0000-4000-8000-000000000205',
  status: 'active',
  phase: 'lead_finalize',
  finalText: null,
  controlState: 'lead_running',
  revision: 4,
  leadTurnCount: 2,
  stopReason: null,
  completionRequestedByRunId: '00000000-0000-4000-8000-000000000206',
  completionApprovalRequired: true,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};
type RouteTeam = Omit<typeof team, 'status' | 'stopReason'> & {
  status: string;
  stopReason: string | null;
};

function setup(teamValue: RouteTeam = team) {
  const app = new Hono<ApiEnvironment>();
  const decideCompletion = vi.fn(async () => ({
    team,
    decision: {
      id: '00000000-0000-4000-8000-000000000208',
      teamRunId: team.id,
      tenantId: 'tenant-decision',
      workspaceId: 'workspace-decision',
      principalType: 'service_account',
      principalId: 'svc_decision',
      completionRequestedByRunId: team.completionRequestedByRunId,
      decision: 'approve',
      feedback: null,
      decidedBy: 'svc_decision',
      decidedAt: '2026-08-08T00:01:00.000Z',
      teamRevisionAtDecision: 4,
      leadTurnCountAtDecision: 2,
      targets: [],
    },
  }));
  const teamExecutions = {
    findTeamRunById: vi.fn(async () => teamValue),
    findTeamRunByRootTaskId: vi.fn(async () => teamValue),
    findCompletionDecisionsByTeamRunId: vi.fn(async () => []),
    findMembersByTeamRunId: vi.fn(async () => []),
    findWorkItemsByTeamRunId: vi.fn(async () => []),
  };
  registerTeamRunRoutes(app, {
    config,
    teamExecutions: teamExecutions as never,
    projectAgenticTeam: { execute: vi.fn(), project: vi.fn() } as never,
    teamDriver: { decideCompletion } as never,
  });
  app.onError((error, c) => {
    if (error instanceof HttpError)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    if (error instanceof TeamExecutionError) {
      const status = error.code === 'invalid_target' ? 422 : 409;
      return c.json(
        { error: { code: error.code, message: error.message } },
        status,
      );
    }
    return c.json(
      { error: { code: 'internal_error', message: error.message } },
      500,
    );
  });
  return { app, decideCompletion };
}

const headers = {
  authorization: 'Bearer decision-token',
  'content-type': 'application/json',
};

describe('team completion decision route', () => {
  it('passes owner and principal identity to the injected driver', async () => {
    const { app, decideCompletion } = setup();
    const response = await app.request(
      `/api/v1/team-runs/${team.id}/completion-decisions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ decision: 'approve', expected_revision: 4 }),
      },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      decision: { team_run_id: string };
      team_run: { status: string };
    };
    expect(payload.decision.team_run_id).toBe(team.id);
    expect(payload.team_run.status).toBe('waiting');
    expect(decideCompletion).toHaveBeenCalledWith({
      teamRunId: team.id,
      expectedRevision: 4,
      owner: expect.objectContaining({
        tenantId: 'tenant-decision',
        workspaceId: 'workspace-decision',
        principalId: 'svc_decision',
      }),
      decidedBy: 'svc_decision',
      decision: 'approve',
    });
  });

  it('rejects approve extra fields at the schema boundary', async () => {
    const { app, decideCompletion } = setup();
    const response = await app.request(
      `/api/v1/team-runs/${team.id}/completion-decisions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision: 'approve',
          expected_revision: 4,
          work_item_ids: [],
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(decideCompletion).not.toHaveBeenCalled();
  });

  it('maps an invalid foreign reject target to 422', async () => {
    const { app, decideCompletion } = setup();
    decideCompletion.mockRejectedValueOnce(
      new TeamExecutionError('invalid_target'),
    );
    const response = await app.request(
      `/api/v1/team-runs/${team.id}/completion-decisions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          decision: 'reject',
          expected_revision: 4,
          feedback: 'Fix the source links.',
          work_item_ids: ['00000000-0000-4000-8000-000000000207'],
        }),
      },
    );
    expect(response.status).toBe(422);
  });

  it('rejects a malformed team-run path ID before repository access', async () => {
    const { app } = setup();
    const response = await app.request(
      '/api/v1/team-runs/not-a-uuid/completion-decisions',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ decision: 'approve', expected_revision: 4 }),
      },
    );
    expect(response.status).toBe(400);
  });

  it('does not mask a failed Lead run as approval waiting on GET', async () => {
    const failedTeam = {
      ...team,
      status: 'failed' as const,
      stopReason: 'lead_run_failed',
    };
    const { app } = setup(failedTeam);
    const response = await app.request(`/api/v1/team-runs/${team.id}`, {
      headers,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      status: string;
      stop_reason: string | null;
    };
    expect(payload.status).toBe('failed');
    expect(payload.stop_reason).toBe('lead_run_failed');
  });
});
