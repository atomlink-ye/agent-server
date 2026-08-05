import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  AgentServerError,
  getAgenticTeamConfig,
  getAgenticTeamProject,
  getAllRunEvents,
  invokeConfiguredAgenticTeam,
  openRunEventStream,
  type AgenticTeamProjectResponse,
} from './agent-server-client';
import {
  BffError,
  BffRequestError,
  MAX_LAUNCH_BODY_BYTES,
  readBoundedJson,
} from './self-learning-bff';
import { safeRunEvent } from './safe-run-events';

export { BffError };

export type TeamProjectProjection = {
  root_task_id: string;
  team_run_id: string;
  name: 'Agentic Team';
  status: 'working' | 'completed' | 'failed';
  phase: 'planning' | 'working' | 'review' | 'completed' | 'failed';
  final_text: string | null;
  work_items: readonly TeamWorkItemProjection[];
  gates: TeamGateProjection;
  direct_messages: readonly TeamDirectMessageProjection[];
  sessions: readonly {
    agent_session_id: string;
    name: string;
    role: 'lead' | 'member';
    status: 'queued' | 'running' | 'completed' | 'failed';
    latest_summary: string | null;
  }[];
};

export type TeamWorkItemProjection = {
  work_ref: string;
  subject: string;
  status:
    | 'pending'
    | 'ready'
    | 'in_progress'
    | 'submitted'
    | 'accepted'
    | 'changes_requested'
    | 'blocked';
  assignee_name: string | null;
  dependency_refs: readonly string[];
  latest_attempt: {
    attempt_no: number;
    status: 'queued' | 'running' | 'completed' | 'failed';
    feedback_summary: string | null;
    result_summary: string | null;
  } | null;
};

export type TeamGateProjection = {
  finish_ready: boolean;
  all_work_accepted: boolean;
  no_active_attempts: boolean;
  all_members_idle: boolean;
};

export type TeamDirectMessageProjection = {
  sequence: number;
  sender_name: string;
  recipient_name: string;
  summary: string;
  created_at: string;
  status: 'delivered' | 'read';
};

export type TeamAgentSessionProjection = {
  agent_session_id: string;
  team_run_id: string;
  name: string;
  role: 'lead' | 'member';
  read_only: true;
  turns: readonly {
    task_id: string;
    run_id: string;
    sequence: number;
    assignment_summary: string;
    result_summary: string | null;
    status: 'queued' | 'running' | 'completed' | 'failed';
  }[];
};

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export const validTeamUuid = (value: string) => uuid(value);

function config() {
  const value = getAgenticTeamConfig();
  if (
    !uuid(value.workspaceId) ||
    !uuid(value.teamVersionId) ||
    !uuid(value.environmentVersionId)
  )
    throw new AgentServerError(503, 'web_configuration_missing');
  return value as {
    workspaceId: string;
    teamVersionId: string;
    environmentVersionId: string;
  };
}

export async function startTeamProject() {
  config();
  const result = await safeUpstream(() =>
    invokeConfiguredAgenticTeam(
      'Lead: coordinate the fixed Agentic Team project and complete the assigned work.',
      randomUUID(),
    ),
  );
  if (!uuid(result.task_id)) throw new BffError('bad_gateway');
  return { root_task_id: result.task_id };
}

export async function getProject(
  rootTaskId?: string,
): Promise<TeamProjectProjection | null> {
  const c = config();
  const raw = await rawProject(rootTaskId);
  if (!raw.project) return null;
  if (raw.project.team_version_id !== c.teamVersionId)
    throw new BffError('not_found');
  const sessions = raw.sessions ?? [];
  if (sessions.length !== 3) throw new BffError('bad_gateway');
  return {
    root_task_id: mustUuid(raw.project.root_task_id),
    team_run_id: mustUuid(raw.project.team_run_id),
    name: 'Agentic Team',
    status: projectStatus(raw.project.status),
    phase: projectPhase(raw.project.phase, raw.project.status),
    final_text: projectFinalSummary(raw.project.status, raw.project.final_text),
    work_items: (raw.work_items ?? []).map(projectWorkItem),
    gates: projectGate(raw.gates),
    direct_messages: (raw.direct_messages ?? []).map(projectDirectMessage),
    sessions: sessions.map((session, index) => ({
      agent_session_id: mustUuid(session.team_member_run_id),
      name: agentLabel(index),
      role: session.role,
      status: sessionStatus(session.status, session.turns.length),
      latest_summary: latestSummary(session),
    })),
  };
}
function projectPhase(
  value: unknown,
  status: 'active' | 'waiting' | 'succeeded' | 'failed',
): TeamProjectProjection['phase'] {
  if (value === 'lead_kickoff') return 'planning';
  if (value === 'member_work') return 'working';
  if (value === 'lead_finalize') return 'review';
  if (value === 'done') return status === 'failed' ? 'failed' : 'completed';
  if (value !== undefined) throw new BffError('bad_gateway');
  return status === 'succeeded'
    ? 'completed'
    : status === 'failed'
      ? 'failed'
      : 'working';
}
function projectWorkItem(
  value: NonNullable<AgenticTeamProjectResponse['work_items']>[number],
  index: number,
): TeamWorkItemProjection {
  return {
    work_ref: `work-${index + 1}`,
    subject: `Work item ${index + 1}`,
    status: workItemStatus(value.status),
    assignee_name: null,
    dependency_refs: [],
    latest_attempt:
      value.latest_attempt === null
        ? null
        : {
            attempt_no: safeAttemptNumber(value.latest_attempt.attempt_no),
            status: attemptStatus(value.latest_attempt.status),
            feedback_summary: attemptSummary(value.latest_attempt.status),
            result_summary: attemptSummary(value.latest_attempt.status),
          },
  };
}
function projectGate(
  value: AgenticTeamProjectResponse['gates'],
): TeamGateProjection {
  if (!value) throw new BffError('bad_gateway');
  return {
    finish_ready: requiredBoolean(value.finish_ready),
    all_work_accepted: requiredBoolean(value.all_work_accepted),
    no_active_attempts: requiredBoolean(value.no_active_attempts),
    all_members_idle: requiredBoolean(value.all_members_idle),
  };
}
function projectDirectMessage(
  value: NonNullable<AgenticTeamProjectResponse['direct_messages']>[number],
): TeamDirectMessageProjection {
  return {
    sequence: safeSequence(value.sequence),
    sender_name: 'Team member',
    recipient_name: 'Team member',
    summary: 'Coordination update recorded.',
    status: directMessageStatus(value.status),
    created_at: safeTimestamp(value.created_at),
  };
}
function workItemStatus(value: unknown): TeamWorkItemProjection['status'] {
  if (
    value === 'pending' ||
    value === 'ready' ||
    value === 'in_progress' ||
    value === 'submitted' ||
    value === 'accepted' ||
    value === 'changes_requested' ||
    value === 'blocked'
  )
    return value;
  throw new BffError('bad_gateway');
}
function directMessageStatus(
  value: unknown,
): TeamDirectMessageProjection['status'] {
  if (value === 'delivered' || value === 'read') return value;
  throw new BffError('bad_gateway');
}
function attemptStatus(
  value: unknown,
): NonNullable<TeamWorkItemProjection['latest_attempt']>['status'] {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed'
  )
    return value;
  throw new BffError('bad_gateway');
}
function safeAttemptNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new BffError('bad_gateway');
  return value as number;
}
function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BffError('bad_gateway');
  return value;
}
function safeTimestamp(value: unknown): string {
  const timestamp = bounded(value, 64);
  if (!Number.isFinite(Date.parse(timestamp)))
    throw new BffError('bad_gateway');
  return timestamp;
}

export async function getSession(
  rootTaskId: string | undefined,
  memberId: string,
) {
  const raw = await rawProject(rootTaskId);
  const session = (raw.sessions ?? []).find(
    (item) => item.team_member_run_id === memberId,
  );
  if (!session || !raw.project) throw new BffError('not_found');
  return {
    agent_session_id: mustUuid(session.team_member_run_id),
    team_run_id: mustUuid(raw.project.team_run_id),
    name: agentLabel((raw.sessions ?? []).indexOf(session)),
    role: session.role,
    read_only: true as const,
    turns: session.turns
      .map((turn) => ({
        task_id: mustUuid(turn.task_id),
        run_id: mustUuid(turn.run_id),
        sequence: safeSequence(turn.sequence),
        assignment_summary: assignmentSummary(turn.status),
        result_summary: resultSummary(turn.status, turn.result_text),
        status: turn.status,
      }))
      .sort((a, b) => a.sequence - b.sequence),
  } satisfies TeamAgentSessionProjection;
}

export async function getHistoricalEvents(
  rootTaskId: string | undefined,
  memberId: string,
  runId: string,
) {
  const session = await getSession(rootTaskId, memberId);
  if (!session.turns.some((turn) => turn.run_id === runId))
    throw new BffError('not_found');
  return (await safeUpstream(() => getAllRunEvents(runId)))
    .map(safeRunEvent)
    .filter((event): event is NonNullable<typeof event> => event !== null);
}

export async function openProjectStream(
  rootTaskId: string | undefined,
  runId: string,
  input: {
    after: string | null;
    lastEventId: string | null;
    signal: AbortSignal;
  },
) {
  const raw = await rawProject(rootTaskId);
  if (
    !(raw.sessions ?? []).some((session) =>
      session.turns.some((turn) => turn.run_id === runId),
    )
  )
    throw new BffError('not_found');
  return safeUpstream(() => openRunEventStream(runId, input));
}

export { BffRequestError, MAX_LAUNCH_BODY_BYTES, readBoundedJson };

async function rawProject(
  rootTaskId?: string,
): Promise<AgenticTeamProjectResponse> {
  if (rootTaskId && !uuid(rootTaskId)) throw new BffError('not_found');
  const c = config();
  const project = await safeUpstream(() => getAgenticTeamProject(rootTaskId));
  if (project.project && project.project.team_version_id !== c.teamVersionId)
    throw new BffError('not_found');
  return project;
}
function projectStatus(
  value: 'active' | 'waiting' | 'succeeded' | 'failed',
): TeamProjectProjection['status'] {
  return value === 'succeeded'
    ? 'completed'
    : value === 'failed'
      ? 'failed'
      : 'working';
}
function sessionStatus(
  value: string,
  turnCount: number,
): TeamProjectProjection['sessions'][number]['status'] {
  return value === 'failed'
    ? 'failed'
    : turnCount === 0
      ? 'queued'
      : value === 'starting' || value === 'active'
        ? 'running'
        : 'completed';
}
function latestSummary(
  session: NonNullable<AgenticTeamProjectResponse['sessions']>[number],
) {
  const turn = [...session.turns].sort((a, b) => b.sequence - a.sequence)[0];
  return turn ? resultSummary(turn.status, turn.result_text) : null;
}
function agentLabel(index: number): string {
  return index === 0 ? 'Lead agent' : `Team member ${index}`;
}
function projectFinalSummary(
  status: 'active' | 'waiting' | 'succeeded' | 'failed',
  finalText: unknown,
): string | null {
  if (finalText === null) return null;
  if (typeof finalText !== 'string') throw new BffError('bad_gateway');
  return status === 'failed'
    ? 'The team project did not complete.'
    : 'The team project completed.';
}
function assignmentSummary(status: string): string {
  return status === 'running'
    ? 'Assignment in progress.'
    : status === 'failed'
      ? 'Assignment closed without completion.'
      : 'Assignment recorded.';
}
function resultSummary(status: string, resultText: unknown): string | null {
  if (resultText === null) return null;
  if (typeof resultText !== 'string') throw new BffError('bad_gateway');
  return status === 'failed'
    ? 'No saved completion summary.'
    : 'Saved completion summary.';
}
function attemptSummary(status: string): string {
  return status === 'running'
    ? 'Attempt in progress.'
    : status === 'completed'
      ? 'Attempt completed.'
      : status === 'failed'
        ? 'Attempt did not complete.'
        : 'Attempt queued.';
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max)
    throw new BffError('bad_gateway');
  return value;
}
function nullableBounded(value: unknown, max: number): string | null {
  return value === null ? null : bounded(value, max);
}
function mustUuid(value: unknown): string {
  if (!uuid(value)) throw new BffError('bad_gateway');
  return value;
}
function safeSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new BffError('bad_gateway');
  return value as number;
}
async function safeUpstream<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BffError) throw error;
    if (error instanceof AgentServerError && error.status === 404)
      throw new BffError('not_found');
    throw new BffError('bad_gateway');
  }
}
