import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import {
  BffRequestError,
  MAX_LAUNCH_BODY_BYTES,
  readBoundedJson,
  startTeamProject,
} from '@/lib/agentic-team-bff';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (
    !sameOrigin(request) ||
    request.headers.get('content-type') !== 'application/json'
  )
    return out({ error: 'invalid_request' }, 400);
  try {
    const body = await readBoundedJson(request, MAX_LAUNCH_BODY_BYTES);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      return out({ error: 'invalid_request' }, 400);
    return out(await startTeamProject(), 202);
  } catch (error) {
    return errorOut(error);
  }
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin'),
    host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function out(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
function errorOut(error: unknown) {
  const status =
    error instanceof BffRequestError
      ? error.status
      : error instanceof AgentServerError && error.status === 503
        ? 503
        : 502;
  return out(
    {
      error:
        status === 503
          ? 'web_configuration_missing'
          : error instanceof BffRequestError && status === 413
            ? 'request_too_large'
            : error instanceof BffRequestError
              ? 'invalid_request'
              : 'upstream_unavailable',
    },
    status,
  );
}
