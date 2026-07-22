// app/api/test-stream/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  try {
    console.log('Testing stream for URL:', url);
    
    // Get first 1MB chunk only
    const upstreamHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Range': 'bytes=0-1048575', // First 1MB
      'Accept': 'video/*,*/*;q=0.9',
    });

    console.log('Making range request for first 1MB...');
    const upstream = await fetch(url, {
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    console.log('Upstream response:', upstream.status, upstream.statusText);

    if (!upstream.ok && upstream.status !== 206) {
      console.error('Upstream error:', upstream.status, upstream.statusText);
      return new NextResponse(`Upstream error: ${upstream.statusText}`, {
        status: upstream.status,
      });
    }

    // Check if server actually honored the range request
    if (upstream.status === 200) {
      console.log('Server returned 200 instead of 206 - range not supported or full file returned');
      
      // If it's a 200 response to a range request, we need to read only the requested amount
      const reader = upstream.body?.getReader();
      if (!reader) {
        return new NextResponse('No response body', { status: 500 });
      }

      // Read only the first 1MB
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxBytes = 1048576; // 1MB

      try {
        while (totalBytes < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const remainingBytes = maxBytes - totalBytes;
          if (value.length <= remainingBytes) {
            chunks.push(value);
            totalBytes += value.length;
          } else {
            // Truncate the last chunk
            chunks.push(value.slice(0, remainingBytes));
            totalBytes += remainingBytes;
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      console.log(`Read ${totalBytes} bytes from stream`);

      // Combine chunks
      const combinedArray = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      }

      const resHeaders = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
        'Content-Length': totalBytes.toString(),
        'Content-Range': `bytes 0-${totalBytes - 1}/${totalBytes}`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Cache-Control': 'public, max-age=3600',
      });

      return new NextResponse(combinedArray, {
        status: 206,
        headers: resHeaders,
      });
    }

    const resHeaders = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control': 'public, max-age=3600',
    });

    // Forward important headers
    ['content-length', 'content-range'].forEach(header => {
      const value = upstream.headers.get(header);
      if (value) {
        console.log(`Forwarding header ${header}: ${value}`);
        resHeaders.set(header, value);
      }
    });

    console.log('Returning response with status:', upstream.status);
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });

  } catch (error) {
    console.error('Test stream error:', error);
    return NextResponse.json(
      { error: 'Failed to test stream', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
