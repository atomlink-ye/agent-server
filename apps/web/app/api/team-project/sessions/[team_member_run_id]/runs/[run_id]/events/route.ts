import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import {
  BffError,
  getHistoricalEvents,
  validTeamUuid,
} from '@/lib/agentic-team-bff';
export const dynamic = 'force-dynamic';
type Context = {
  params: Promise<{ team_member_run_id: string; run_id: string }>;
};
export async function GET(request: Request, context: Context) {
  const { team_member_run_id: member, run_id: run } = await context.params;
  const task = new URL(request.url).searchParams.get('task') ?? undefined;
  if (
    !validTeamUuid(member) ||
    !validTeamUuid(run) ||
    (task && !validTeamUuid(task))
  )
    return out({ error: 'not_found' }, 404);
  try {
    return out({ events: await getHistoricalEvents(task, member, run) }, 200);
  } catch (error) {
    return fail(error);
  }
}
function out(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
function fail(error: unknown) {
  const status =
    error instanceof AgentServerError && error.status === 503
      ? 503
      : error instanceof BffError && error.kind === 'bad_gateway'
        ? 502
        : 404;
  return out(
    {
      error:
        status === 503
          ? 'web_configuration_missing'
          : status === 502
            ? 'upstream_unavailable'
            : 'not_found',
    },
    status,
  );
}
