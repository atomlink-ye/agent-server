import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import { BffError, getProject, validTeamUuid } from '@/lib/agentic-team-bff';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const task = new URL(request.url).searchParams.get('task') ?? undefined;
  if (task && !validTeamUuid(task)) return out({ error: 'not_found' }, 404);
  try {
    return out(await getProject(task), 200);
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
