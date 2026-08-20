import { NextResponse } from 'next/server';

import { conversationErrorResponse, readConversationBff } from '@/lib/conversation-bff';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversation_id: string }> },
) {
  try {
    const { conversation_id: conversationId } = await params;
    return NextResponse.json(await readConversationBff(conversationId));
  } catch (error) {
    const safe = conversationErrorResponse(error);
    return NextResponse.json(safe.body, { status: safe.status });
  }
}
