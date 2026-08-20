import { NextResponse } from 'next/server';

import {
  conversationErrorResponse,
  listConversationBff,
} from '@/lib/conversation-bff';
import { readProductSessionId } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listConversationBff(await readProductSessionId()));
  } catch (error) {
    const safe = conversationErrorResponse(error);
    return NextResponse.json(safe.body, { status: safe.status });
  }
}
