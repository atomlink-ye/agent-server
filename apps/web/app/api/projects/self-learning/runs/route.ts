import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import {
  BffRequestError,
  MAX_LAUNCH_BODY_BYTES,
  readBoundedJson,
  startLearning,
} from '@/lib/self-learning-bff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return response({ error: 'forbidden' }, 403);
  if (request.headers.get('content-type') !== 'application/json')
    return response({ error: 'invalid_request' }, 400);
  try {
    const body = await readBoundedJson(request, MAX_LAUNCH_BODY_BYTES);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    )
      return response({ error: 'invalid_request' }, 400);
    return response({ root_task_id: await startLearning() }, 202);
  } catch (error) {
    return errorResponse(error);
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
function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
function errorResponse(error: unknown) {
  if (error instanceof BffRequestError)
    return response(
      { error: error.status === 413 ? 'request_too_large' : 'invalid_request' },
      error.status,
    );
  return response(
    {
      error:
        error instanceof AgentServerError && error.status === 503
          ? 'web_configuration_missing'
          : 'upstream_unavailable',
    },
    error instanceof AgentServerError && error.status === 503 ? 503 : 502,
  );
}
