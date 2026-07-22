import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DebugEntry = {
  time?: unknown;
  event?: unknown;
  data?: unknown;
};

function safeEntry(value: unknown): DebugEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as DebugEntry;
  if (typeof entry.event !== 'string') return null;
  return {
    time: typeof entry.time === 'string' ? entry.time : new Date().toISOString(),
    event: entry.event.slice(0, 160),
    data: entry.data,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.STREAM_DEBUG !== '1') {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const payload = (await request.json()) as { entries?: unknown };
    const values = Array.isArray(payload.entries) ? payload.entries.slice(0, 50) : [];

    for (const value of values) {
      const entry = safeEntry(value);
      if (!entry) continue;
      const prefix = `[stream-debug][browser] ${entry.time} ${entry.event}`;
      if (entry.data === undefined) console.log(prefix);
      else console.log(prefix, entry.data);
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[stream-debug][server] Failed to receive browser diagnostics:', error);
    return NextResponse.json({ error: 'Invalid stream debug payload' }, { status: 400 });
  }
}
