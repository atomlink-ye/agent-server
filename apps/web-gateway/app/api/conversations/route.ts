import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Conversation gateway is not implemented yet.' },
    { status: 501 },
  );
}
