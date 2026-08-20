import { NextResponse } from 'next/server';

import {
  conversationErrorResponse,
  createConversationBff,
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

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const agentDefinitionId =
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      Object.prototype.hasOwnProperty.call(body, 'agent_definition_id')
        ? (body as { agent_definition_id?: unknown }).agent_definition_id
        : undefined;
    return NextResponse.json(
      await createConversationBff(
        await readProductSessionId(),
        agentDefinitionId,
      ),
      { status: 201 },
    );
  } catch (error) {
    const safe = conversationErrorResponse(error);
    return NextResponse.json(safe.body, { status: safe.status });
  }
}
