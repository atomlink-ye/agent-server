import { NextResponse } from 'next/server';

import {
  conversationErrorResponse,
  postConversationBff,
} from '@/lib/conversation-bff';
import { readProductSessionId } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversation_id: string }> },
) {
  try {
    const { conversation_id: conversationId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const payload =
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      Object.prototype.hasOwnProperty.call(body, 'body')
        ? (body as { body?: unknown }).body
        : undefined;
    return NextResponse.json(
      await postConversationBff(
        await readProductSessionId(),
        conversationId,
        payload,
      ),
      { status: 202 },
    );
  } catch (error) {
    const safe = conversationErrorResponse(error);
    return NextResponse.json(safe.body, { status: safe.status });
  }
}
