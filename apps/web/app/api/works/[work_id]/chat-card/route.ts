import { NextResponse } from 'next/server';

import {
  readWorkChatCardBff,
  workChatCardErrorResponse,
} from '@/lib/work-chat-card-bff';
import { readProductSessionId } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ work_id: string }> },
) {
  try {
    const { work_id: workId } = await params;
    return NextResponse.json(
      await readWorkChatCardBff(await readProductSessionId(), workId),
    );
  } catch (error) {
    const safe = workChatCardErrorResponse(error);
    return NextResponse.json(safe.body, { status: safe.status });
  }
}
