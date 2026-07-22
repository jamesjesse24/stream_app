// app/api/stream/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  // Extract the base64 encoded URL from the path
  const encodedUrl = params.path[0];
  
  if (!encodedUrl) {
    return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
  }

  try {
    // Decode the URL
    const url = decodeURIComponent(encodedUrl);
    
    // Redirect to our streaming endpoint with .mp4 extension
    const streamUrl = `/api/stream-mkv?url=${encodeURIComponent(url)}`;
    
    // Forward all headers and query parameters
    const response = await fetch(`${req.nextUrl.origin}${streamUrl}`, {
      method: req.method,
      headers: req.headers
    });

    // Return the response with explicit MP4 content type
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Content-Type', 'video/mp4');
    responseHeaders.set('Content-Disposition', 'inline; filename="video.mp4"');
    
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: 'Failed to stream video',
      details: errorMessage
    }, { status: 500 });
  }
}
