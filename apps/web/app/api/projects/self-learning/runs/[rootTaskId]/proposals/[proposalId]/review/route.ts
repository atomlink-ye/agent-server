import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import {
  BffError,
  BffRequestError,
  MAX_REVIEW_BODY_BYTES,
  readBoundedJson,
  review,
  validUuid,
} from '@/lib/self-learning-bff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ rootTaskId: string; proposalId: string }> };
export async function POST(request: Request, context: Context) {
  const { rootTaskId, proposalId } = await context.params;
  if (!sameOrigin(request)) return out({ error: 'forbidden' }, 403);
  if (request.headers.get('content-type') !== 'application/json')
    return out({ error: 'invalid_request' }, 400);
  if (!validUuid(rootTaskId) || !validUuid(proposalId))
    return out({ error: 'not_found' }, 404);
  try {
    const body = await readBoundedJson(request, MAX_REVIEW_BODY_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return out({ error: 'invalid_request' }, 400);
    const fields = body as Record<string, unknown>;
    const keys = Object.keys(fields);
    let action: 'accept' | 'reject' | 'edit_and_accept';
    let content: string | undefined;
    if (keys.length === 1 && fields.action === 'accept') action = 'accept';
    else if (keys.length === 1 && fields.action === 'reject') action = 'reject';
    else if (
      keys.length === 2 &&
      fields.action === 'edit_and_accept' &&
      typeof fields.content === 'string' &&
      new TextEncoder().encode(fields.content).byteLength >= 1 &&
      new TextEncoder().encode(fields.content).byteLength <= 8192
    ) {
      action = 'edit_and_accept';
      content = fields.content;
    } else return out({ error: 'invalid_request' }, 400);
    return out(await review(rootTaskId, proposalId, action, content), 200);
  } catch (e) {
    if (e instanceof BffRequestError)
      return out(
        { error: e.status === 413 ? 'request_too_large' : 'invalid_request' },
        e.status,
      );
    if (e instanceof BffError && e.kind === 'conflict')
      return out({ error: e.code }, 409);
    if (e instanceof BffError && e.kind === 'bad_gateway')
      return out({ error: 'upstream_unavailable' }, 502);
    if (e instanceof AgentServerError && e.status === 503)
      return out({ error: 'web_configuration_missing' }, 503);
    return out({ error: 'not_found' }, 404);
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
