// app/api/debug-stream/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const debug = req.nextUrl.searchParams.get('debug') === 'true';
  
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const debugInfo: any = {
    requestInfo: {
      url: url,
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      timestamp: new Date().toISOString(),
    },
    upstreamInfo: {},
    responseInfo: {},
    errors: [],
  };

  try {
    new URL(url);
    debugInfo.requestInfo.urlValid = true;
  } catch {
    debugInfo.requestInfo.urlValid = false;
    debugInfo.errors.push('Invalid URL format');
    return NextResponse.json(debugInfo, { status: 400 });
  }

  const range = req.headers.get('range');
  debugInfo.requestInfo.rangeRequested = range || 'No range header';

  try {
    // First, try HEAD request to get file info
    console.log('🔍 DEBUG: Making HEAD request to:', url);
    const headResponse = await fetch(url, { 
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });

    debugInfo.upstreamInfo.headRequest = {
      status: headResponse.status,
      statusText: headResponse.statusText,
      headers: Object.fromEntries(headResponse.headers.entries()),
      ok: headResponse.ok,
    };

    if (!headResponse.ok) {
      debugInfo.errors.push(`HEAD request failed: ${headResponse.status} ${headResponse.statusText}`);
      if (debug) {
        return NextResponse.json(debugInfo, { status: 500 });
      }
    }

    // Try to get file size and type
    const contentLength = headResponse.headers.get('content-length');
    const contentType = headResponse.headers.get('content-type');
    
    debugInfo.upstreamInfo.fileSize = contentLength ? parseInt(contentLength) : null;
    debugInfo.upstreamInfo.contentType = contentType;
    debugInfo.upstreamInfo.supportsRanges = headResponse.headers.get('accept-ranges') === 'bytes';

    // Determine if this looks like MKV
    const isMkvFile = url.toLowerCase().includes('.mkv') || 
                     contentType?.toLowerCase().includes('mkv') ||
                     url.toLowerCase().includes('mkv');
    
    debugInfo.upstreamInfo.detectedAsMkv = isMkvFile;

    // Now try the actual stream request
    const upstreamHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'video/*,*/*;q=0.9',
    });

    if (range) {
      upstreamHeaders.set('Range', range);
    }

    console.log('🔍 DEBUG: Making GET request with headers:', Object.fromEntries(upstreamHeaders.entries()));
    
    const upstream = await fetch(url, {
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    debugInfo.upstreamInfo.getRequest = {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: Object.fromEntries(upstream.headers.entries()),
      ok: upstream.ok,
    };

    if (!upstream.ok && upstream.status !== 206) {
      debugInfo.errors.push(`GET request failed: ${upstream.status} ${upstream.statusText}`);
      if (debug) {
        return NextResponse.json(debugInfo, { status: 500 });
      }
    }

    // If debug mode, return debug info instead of streaming
    if (debug) {
      debugInfo.responseInfo.wouldStream = true;
      debugInfo.responseInfo.streamHeaders = {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4', // Forced for compatibility
        'Content-Length': upstream.headers.get('content-length'),
        'Content-Range': upstream.headers.get('content-range'),
      };
      
      return NextResponse.json(debugInfo, { 
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    // Normal streaming response
    const resHeaders = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4', // Force MP4 for browser compatibility
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control': 'public, max-age=3600',
    });

    // Forward important headers from upstream
    ['content-length', 'content-range'].forEach(header => {
      const value = upstream.headers.get(header);
      if (value) resHeaders.set(header, value);
    });

    console.log('🔍 DEBUG: Streaming response with status:', upstream.status);
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });

  } catch (error) {
    console.error('🔍 DEBUG: Stream error:', error);
    debugInfo.errors.push(`Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
    debugInfo.exception = {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : null,
    };
    
    return NextResponse.json(debugInfo, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
