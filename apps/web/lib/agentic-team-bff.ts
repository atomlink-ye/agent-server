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

export { BffError };

export type TeamProjectProjection = {
  root_task_id: string;
  team_run_id: string;
  name: 'Agentic Team';
  status: 'working' | 'completed' | 'failed';
  sessions: readonly {
    agent_session_id: string;
    name: string;
    role: 'lead' | 'member';
    status: 'queued' | 'running' | 'completed' | 'failed';
    latest_summary: string | null;
  }[];
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
    context: string;
    result_text: string | null;
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
    sessions: sessions.map((session) => ({
      agent_session_id: mustUuid(session.team_member_run_id),
      name: bounded(session.name, 256),
      role: session.role,
      status: sessionStatus(session.status, session.turns.length),
      latest_summary: latestSummary(session),
    })),
  };
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
    name: bounded(session.name, 256),
    role: session.role,
    read_only: true as const,
    turns: session.turns
      .map((turn) => ({
        task_id: mustUuid(turn.task_id),
        run_id: mustUuid(turn.run_id),
        sequence: safeSequence(turn.sequence),
        context: bounded(turn.context, 512),
        result_text: nullableBounded(turn.result_text, 4096),
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
  return safeUpstream(() => getAllRunEvents(runId));
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
  return turn ? nullableBounded(turn.result_text, 4096) : null;
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
