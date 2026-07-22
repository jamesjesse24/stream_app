import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class ProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

function parseGoogleVideoUrl(value: string | null): URL {
  if (!value) throw new ProxyError(400, 'Missing url parameter');

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new ProxyError(400, 'url must be a valid absolute URL');
  }

  if (target.protocol !== 'https:') {
    throw new ProxyError(400, 'Only HTTPS Google video URLs are supported');
  }

  const hostname = target.hostname.toLowerCase();
  if (
    hostname !== 'video-downloads.googleusercontent.com' &&
    !hostname.endsWith('.video-downloads.googleusercontent.com')
  ) {
    throw new ProxyError(403, 'Only Google video-download URLs are permitted');
  }

  if (target.username || target.password) {
    throw new ProxyError(400, 'URLs containing credentials are not supported');
  }

  return target;
}

function createUpstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers({
    Accept: request.headers.get('accept') || 'video/*,*/*;q=0.9',
    'Accept-Encoding': 'identity',
    'User-Agent': USER_AGENT,
  });

  const range = request.headers.get('range');
  if (range) headers.set('Range', range);
  return headers;
}

function createResponseHeaders(upstream: Response): Headers {
  const headers = new Headers({
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers':
      'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline',
    'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
    'X-Accel-Buffering': 'no',
  });

  for (const name of [
    'content-length',
    'content-range',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function errorResponse(error: unknown): NextResponse {
  const status = error instanceof ProxyError ? error.status : 502;
  const message = error instanceof Error ? error.message : 'Google video proxy failed';
  return NextResponse.json({ error: message }, { status });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function HEAD(request: NextRequest): Promise<NextResponse> {
  try {
    const target = parseGoogleVideoUrl(request.nextUrl.searchParams.get('url'));
    const headers = createUpstreamHeaders(request);
    // Download URLs do not consistently implement HEAD. A one-byte GET gives
    // us the same metadata without downloading the movie.
    headers.set('Range', 'bytes=0-0');
    const upstream = await fetch(target, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: request.signal,
      cache: 'no-store',
    });

    if (upstream.status !== 200 && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => undefined);
      throw new ProxyError(upstream.status, `Upstream returned ${upstream.status}`);
    }

    const responseHeaders = createResponseHeaders(upstream);
    const contentRange = upstream.headers.get('content-range');
    const totalMatch = contentRange?.match(/\/([0-9]+)$/);
    if (totalMatch) responseHeaders.set('Content-Length', totalMatch[1]);
    await upstream.body?.cancel().catch(() => undefined);
    return new NextResponse(null, { status: 200, headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const target = parseGoogleVideoUrl(request.nextUrl.searchParams.get('url'));
    const requestedRange = request.headers.get('range');
    const upstream = await fetch(target, {
      method: 'GET',
      headers: createUpstreamHeaders(request),
      redirect: 'follow',
      signal: request.signal,
      cache: 'no-store',
    });

    if (upstream.status !== 200 && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => undefined);
      throw new ProxyError(upstream.status, `Upstream returned ${upstream.status}`);
    }

    // Returning a full multi-gigabyte response to a byte-range request causes
    // the browser to appear permanently buffering and makes seeking unusable.
    if (requestedRange && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => undefined);
      throw new ProxyError(502, 'Upstream ignored the requested byte range');
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: createResponseHeaders(upstream),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
