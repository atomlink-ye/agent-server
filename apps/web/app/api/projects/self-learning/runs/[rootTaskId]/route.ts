import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import { aggregate, BffError, validUuid } from '@/lib/self-learning-bff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ rootTaskId: string }> };
export async function GET(_: Request, context: Context) {
  const id = (await context.params).rootTaskId;
  if (!validUuid(id)) return out({ error: 'not_found' }, 404);
  try {
    return out(await aggregate(id), 200);
  } catch (e) {
    return error(e);
  }
}
function out(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
function error(e: unknown) {
  const status =
    e instanceof AgentServerError && e.status === 503
      ? 503
      : e instanceof BffError && e.kind === 'bad_gateway'
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
