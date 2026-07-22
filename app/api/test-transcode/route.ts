// app/api/test-transcode/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Test our streaming endpoint
  const streamUrl = `/api/stream-mkv?url=${encodeURIComponent(url)}`;
  
  try {
    // Make a HEAD request to our own streaming endpoint
    const response = await fetch(`${req.nextUrl.origin}${streamUrl}`, {
      method: 'HEAD'
    });
    
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    return NextResponse.json({
      streamUrl,
      status: response.status,
      statusText: response.statusText,
      headers,
      contentType: response.headers.get('content-type'),
      isMP4: response.headers.get('content-type')?.includes('mp4'),
      transcoding: response.headers.get('x-remux') === 'mkv-to-mp4'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: 'Failed to test transcoding endpoint',
      details: errorMessage
    }, { status: 500 });
  }
}
