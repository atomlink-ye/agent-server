import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import { BffError, getSession, validTeamUuid } from '@/lib/agentic-team-bff';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ team_member_run_id: string }> };
export async function GET(request: Request, context: Context) {
  const id = (await context.params).team_member_run_id;
  const task = new URL(request.url).searchParams.get('task') ?? undefined;
  if (!validTeamUuid(id) || (task && !validTeamUuid(task)))
    return out({ error: 'not_found' }, 404);
  try {
    return out(await getSession(task, id), 200);
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
