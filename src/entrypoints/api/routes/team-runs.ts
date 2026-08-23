import type { Hono } from 'hono';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../../../application/ports/team-execution-repository.js';
import { TeamExecutionError } from '../../../application/ports/team-execution-repository.js';
import type { TeamDriver } from '../../../application/teams/team-driver.js';
import { HttpError } from '../../../contracts/http.js';
import {
  TeamRunResponseSchema,
  TeamMemberResponseSchema,
  TeamWorkItemResponseSchema,
  TeamDirectMessageResponseSchema,
  TeamCompletionDecisionRequestSchema,
  TeamCompletionDecisionResponseSchema,
  TeamCompletionDecisionResultResponseSchema,
  MAX_TEAM_REQUEST_BYTES,
} from '../../../contracts/teams.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { z } from 'zod';
import { readBoundedJson } from '../read-bounded-json.js';
import { isTeamCompletionApprovalPending } from '../../../application/teams/team-policy-evaluator.js';
import {
  ProjectAgenticTeam,
  type AgenticTeamProject,
} from '../../../application/teams/project-agentic-team.js';
import {
  AgenticTeamProjectResponseSchema,
  type AgenticTeamProjectResponse,
} from '../../../contracts/teams.js';

export function toAgenticTeamProjectResponse(
  projection: AgenticTeamProject | null,
): AgenticTeamProjectResponse {
  if (!projection)
    return {
      stuck: false,
      decision_capture_status: 'not_captured',
      project: null,
      work_items: [],
      gates: {
        finish_ready: false,
        all_work_accepted: false,
        no_active_attempts: true,
        all_members_idle: true,
      },
      direct_messages: [],
      sessions: [],
    };
  return {
    stuck: projection.stuck,
    ...(projection.decisionCapture.status === 'reported'
      ? {
          decision_capture_status: 'reported' as const,
          decisions:
            projection.decisionCapture.decisions.map(completionDecision),
        }
      : { decision_capture_status: 'not_captured' as const }),
    project: {
      root_task_id: projection.project.rootTaskId,
      team_run_id: projection.project.teamRunId,
      team_version_id: projection.project.teamVersionId,
      status: projection.project.status,
      phase: projection.project.phase,
      final_text: projection.project.finalText,
      revision: projection.project.revision,
      stop_reason: projection.project.stopReason,
      completion_approval_required:
        projection.project.completionApprovalRequired,
      completion_decisions:
        projection.project.completionDecisions.map(completionDecision),
      created_at: projection.project.createdAt,
      updated_at: projection.project.updatedAt,
    },
    work_items: projection.workItems.map((work) => ({
      work_ref: work.workRef,
      subject: work.subject,
      description: work.description,
      status:
        work.status as AgenticTeamProjectResponse['work_items'][number]['status'],
      assignee_name: work.assigneeName,
      dependency_refs: [...work.dependencyRefs],
      attempts: work.attempts.map((attempt) => ({
        attempt_no: attempt.attemptNo,
        status: attempt.status,
        feedback_summary: attempt.feedbackSummary,
        result_summary: attempt.resultSummary,
      })),
      latest_attempt: work.latestAttempt
        ? {
            attempt_no: work.latestAttempt.attemptNo,
            status: work.latestAttempt.status,
            feedback_summary: work.latestAttempt.feedbackSummary,
            result_summary: work.latestAttempt.resultSummary,
          }
        : null,
    })),
    gates: {
      finish_ready: projection.gates.finishReady,
      all_work_accepted: projection.gates.allWorkAccepted,
      no_active_attempts: projection.gates.noActiveAttempts,
      all_members_idle: projection.gates.allMembersIdle,
    },
    direct_messages: projection.directMessages.map((message) => ({
      sequence: message.sequence,
      sender_name: message.senderName,
      recipient_name: message.recipientName,
      summary: message.summary,
      requires_ack: message.requiresAck,
      status: message.status,
      created_at: message.createdAt,
    })),
    sessions: projection.sessions.map((session) => ({
      team_member_run_id: session.teamMemberRunId,
      name: session.name,
      role: session.role,
      status: session.status,
      turns: session.turns.map((turn) => ({
        task_id: turn.taskId,
        run_id: turn.runId,
        sequence: turn.sequence,
        kind: turn.kind,
        activation: turn.activation
          ? {
              materializer: turn.activation.materializer,
              causes: turn.activation.causes.map((cause) =>
                cause.type === 'final_review'
                  ? { type: cause.type }
                  : cause.type === 'message'
                    ? { type: cause.type, message_ref: cause.messageRef }
                    : { type: cause.type, work_ref: cause.workRef },
              ),
            }
          : null,
        status: turn.status,
        context: turn.context,
        result_text: turn.resultText,
        work_item_id: turn.workItemId,
        attempt_id: turn.attemptId,
        attempt_no: turn.attemptNo,
        provider: turn.provider,
        model: turn.model,
        created_at: turn.createdAt,
        updated_at: turn.updatedAt,
      })),
    })),
  };
}
export function registerTeamRunRoutes(
  app: Hono<ApiEnvironment>,
  d: {
    config: AppConfig;
    teamExecutions: TeamExecutionRepository;
    projectAgenticTeam: ProjectAgenticTeam;
    teamDriver?: Pick<TeamDriver, 'decideCompletion'>;
  },
): void {
  const auth = new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []);
  for (const p of ['/api/v1/tasks/*/team-run', '/api/v1/team-runs/*'])
    app.use(p, requireServiceAccountAccess(auth));
  app.use('/api/v1/team-runs:project', requireServiceAccountAccess(auth));
  app.get('/api/v1/team-runs:project', async (c) => {
    const rootTaskId = c.req.query('root_task_id');
    if (rootTaskId && !z.uuid().safeParse(rootTaskId).success)
      throw new HttpError(
        400,
        'invalid_root_task_id',
        'The root task ID is invalid.',
      );
    const projection = await d.projectAgenticTeam.execute(owner(c), rootTaskId);
    return c.json(
      AgenticTeamProjectResponseSchema.parse(
        toAgenticTeamProjectResponse(projection),
      ),
      200,
    );
  });
  app.get('/api/v1/tasks/:taskId/team-run', async (c) => {
    const r = await d.teamExecutions.findTeamRunByRootTaskId(
      c.req.param('taskId'),
      owner(c),
    );
    return c.json(
      r
        ? run(r, await completionHistory(d.teamExecutions, r.id, owner(c)))
        : null,
      200,
    );
  });
  app.get('/api/v1/team-runs/:id', async (c) => {
    const found = await d.teamExecutions.findTeamRunById(
      c.req.param('id'),
      owner(c),
    );
    const r = required(found);
    const decisions = await d.teamExecutions.findCompletionDecisionsByTeamRunId(
      r.id,
      owner(c),
    );
    return c.json(TeamRunResponseSchema.parse(run(r, decisions)), 200);
  });
  app.post('/api/v1/team-runs/:id/completion-decisions', async (c) => {
    const teamRunId = c.req.param('id');
    if (!z.uuid().safeParse(teamRunId).success)
      throw new HttpError(
        400,
        'invalid_team_run_id',
        'The team run ID is invalid.',
      );
    let existing;
    try {
      existing = await d.teamExecutions.findTeamRunById(teamRunId, owner(c));
    } catch (error) {
      if (error instanceof TeamExecutionError && error.code === 'not_found')
        throw new HttpError(404, error.code, error.message);
      throw error;
    }
    if (!existing)
      throw new HttpError(404, 'team_not_found', 'The team run was not found.');
    if (!d.teamDriver)
      throw new HttpError(
        503,
        'team_driver_unavailable',
        'Completion decisions are unavailable.',
      );
    let body: unknown;
    try {
      body = await readBoundedJson(c.req.raw, MAX_TEAM_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        'invalid_request',
        'The request body is invalid.',
      );
    }
    const parsed = TeamCompletionDecisionRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpError(
        400,
        'invalid_request',
        'The completion decision is invalid.',
      );
    const a = owner(c);
    try {
      const input =
        parsed.data.decision === 'approve'
          ? {
              teamRunId,
              expectedRevision: parsed.data.expected_revision,
              owner: a,
              decidedBy: a.principalId,
              decision: 'approve' as const,
            }
          : {
              teamRunId,
              expectedRevision: parsed.data.expected_revision,
              owner: a,
              decidedBy: a.principalId,
              decision: 'reject' as const,
              feedback: parsed.data.feedback,
              workItemIds: parsed.data.work_item_ids,
            };
      const result = await d.teamDriver.decideCompletion(input);
      const decisions = await completionHistory(
        d.teamExecutions,
        result.team.id,
        a,
      );
      const response = {
        decision: completionDecision(result.decision),
        team_run: run(result.team, decisions),
      };
      return c.json(
        TeamCompletionDecisionResultResponseSchema.parse(response),
        200,
      );
    } catch (error) {
      if (error instanceof TeamExecutionError) {
        if (error.code === 'invalid_target')
          throw new HttpError(422, error.code, error.message);
        if (error.code === 'not_found')
          throw new HttpError(404, error.code, error.message);
        if (
          error.code === 'stale_state' ||
          error.code === 'conflict' ||
          error.code === 'invalid_transition' ||
          error.code === 'not_allowed'
        )
          throw new HttpError(409, error.code, error.message);
      }
      throw error;
    }
  });
  app.get('/api/v1/team-runs/:id/members', async (c) => {
    const found = await d.teamExecutions.findTeamRunById(
      c.req.param('id'),
      owner(c),
    );
    const r = required(found);
    return c.json(
      (await d.teamExecutions.findMembersByTeamRunId(r.id, owner(c))).map(
        member,
      ),
      200,
    );
  });
  app.get('/api/v1/team-runs/:id/tasks', async (c) => {
    const found = await d.teamExecutions.findTeamRunById(
      c.req.param('id'),
      owner(c),
    );
    const r = required(found);
    return c.json(
      (await d.teamExecutions.findWorkItemsByTeamRunId(r.id, owner(c))).map(
        work,
      ),
      200,
    );
  });
  app.get('/api/v1/team-runs/:id/direct-messages', async (c) => {
    const projection = await d.projectAgenticTeam.project(
      c.req.param('id'),
      owner(c),
    );
    if (!projection)
      throw new HttpError(404, 'team_not_found', 'The team run was not found.');
    return c.json(
      projection.directMessages.map((message) =>
        TeamDirectMessageResponseSchema.parse({
          sequence: message.sequence,
          sender_name: message.senderName,
          recipient_name: message.recipientName,
          summary: message.summary,
          requires_ack: message.requiresAck,
          status: message.status,
          created_at: message.createdAt,
        }),
      ),
      200,
    );
  });
}
function owner(c: any): OwnerScope {
  const a = getAuthenticatedAccessContext(c);
  return a;
}
function required<T>(v: T | null): T {
  if (!v)
    throw new HttpError(404, 'team_not_found', 'The team run was not found.');
  return v;
}
function run(v: any, decisions: readonly any[]) {
  const currentDecision = decisions.find(
    (decision) =>
      decision.completionRequestedByRunId === v.completionRequestedByRunId,
  );
  const approvalPending = isTeamCompletionApprovalPending(v, currentDecision);
  return TeamRunResponseSchema.parse({
    id: v.id,
    root_task_id: v.rootTaskId,
    root_run_id: v.rootRunId,
    team_version_id: v.teamVersionId,
    environment_version_id: v.environmentVersionId,
    status: approvalPending ? 'waiting' : v.status,
    phase: v.phase,
    final_text: v.finalText,
    control_state: v.controlState,
    revision: v.revision,
    lead_turn_count: v.leadTurnCount,
    stop_reason: approvalPending ? 'approval_required' : v.stopReason,
    completion_requested_by_run_id: v.completionRequestedByRunId,
    completion_approval_required: v.completionApprovalRequired,
    completion_decisions: decisions.map(completionDecision),
    created_at: v.createdAt,
    updated_at: v.updatedAt,
  });
}
async function completionHistory(
  executions: TeamExecutionRepository,
  teamRunId: string,
  ownerScope: OwnerScope,
) {
  const decisions = await executions.findCompletionDecisionsByTeamRunId(
    teamRunId,
    ownerScope,
  );
  return [...decisions].sort(
    (a, b) =>
      a.teamRevisionAtDecision - b.teamRevisionAtDecision ||
      a.decidedAt.localeCompare(b.decidedAt) ||
      a.id.localeCompare(b.id),
  );
}
function completionDecision(v: any) {
  return TeamCompletionDecisionResponseSchema.parse({
    id: v.id,
    team_run_id: v.teamRunId,
    completion_requested_by_run_id: v.completionRequestedByRunId,
    decision: v.decision,
    feedback: v.feedback,
    decided_by: v.decidedBy,
    decided_at: v.decidedAt,
    team_revision_at_decision: v.teamRevisionAtDecision,
    lead_turn_count_at_decision: v.leadTurnCountAtDecision,
    targets: v.targets.map((target: any) => ({
      work_item_id: target.workItemId,
      attempt_no_at_decision: target.attemptNoAtDecision,
    })),
  });
}
function member(v: any) {
  return TeamMemberResponseSchema.parse({
    id: v.id,
    team_run_id: v.teamRunId,
    name: v.name,
    role: v.role,
    agent_version_id: v.agentVersionId,
    runtime_session_id: v.runtimeSessionId,
    status: v.status,
    current_work_item_id: v.currentWorkItemId,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
  });
}
function work(v: any) {
  return TeamWorkItemResponseSchema.parse({
    id: v.id,
    team_run_id: v.teamRunId,
    subject: v.subject,
    description: v.description,
    status: v.status,
    owner_member_id: v.ownerMemberId,
    created_by_member_id: v.createdByMemberId,
    completion_summary: v.completionSummary,
    execution_task_id: v.executionTaskId,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    completed_at: v.completedAt,
  });
}
