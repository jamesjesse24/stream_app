import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { PassThrough, Readable, pipeline } from 'stream';
import { createHash } from 'crypto';
import axios from 'axios';

// Enhanced cache with TTL and process tracking
interface CacheEntry {
  contentLength: number;
  mimeType: string;
  timestamp: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry>();
const activeStreams = new Map<string, Set<any>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const requestedUrl = req.nextUrl.searchParams.get('url');
  if (!requestedUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const rangeHeader = req.headers.get('range');
  const forceVideoTranscode = req.nextUrl.searchParams.get('transcode') === '1';

  try {
    const url = await resolveMediaUrl(requestedUrl);
    const cacheKey = createHash('md5').update(url).digest('hex');

    // ---- 1. Get cached metadata or fetch fresh ----
    let meta = getCachedMeta(cacheKey);
    if (!meta) {
      meta = await fetchAndCacheMeta(url, cacheKey);
    }

    // ---- 2. Direct proxy for MP4 with range support ----
    if (!forceVideoTranscode && meta.mimeType.includes('mp4') && rangeHeader) {
      return proxyRange(req, url, rangeHeader, meta.contentLength, meta.mimeType);
    }

    // ---- 3. Remux non-MP4 formats ----
    return remuxToMp4Stream(req, url, cacheKey, forceVideoTranscode);

  } catch (error) {
    console.error('Stream error:', error);
    return NextResponse.json(
      { error: 'Stream processing failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function getEmbeddedVideoSeedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'video-seed.dev' && !hostname.endsWith('.video-seed.dev')) {
      return null;
    }

    const embeddedUrl = url.searchParams.get('url');
    if (!embeddedUrl) return null;

    const resolvedUrl = new URL(embeddedUrl);
    return ['http:', 'https:'].includes(resolvedUrl.protocol)
      ? resolvedUrl.toString()
      : null;
  } catch {
    return null;
  }
}

async function resolveMediaUrl(value: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid upstream URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Unsupported upstream URL protocol');
  }

  const embeddedUrl = getEmbeddedVideoSeedUrl(url.toString());
  if (embeddedUrl) return embeddedUrl;

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'cdn.video-gen.xyz' || hostname.endsWith('.video-gen.xyz')) {
    const landingResponse = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const resolvedLandingUrl = getEmbeddedVideoSeedUrl(landingResponse.url);
    if (resolvedLandingUrl) return resolvedLandingUrl;
  }

  return url.toString();
}

function getCachedMeta(cacheKey: string): CacheEntry | null {
  const entry = cache.get(cacheKey);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry;
  }
  if (entry) cache.delete(cacheKey); // Remove expired
  return null;
}

async function fetchAndCacheMeta(url: string, cacheKey: string): Promise<CacheEntry> {
  const head = await fetch(url, { 
    method: 'HEAD',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  
  if (!head.ok) {
    throw new Error(`Cannot fetch upstream HEAD: ${head.status}`);
  }

  const meta: CacheEntry = {
    contentLength: Number(head.headers.get('content-length') || 0),
    mimeType: head.headers.get('content-type') || 'video/x-matroska',
    timestamp: Date.now(),
    etag: head.headers.get('etag') || undefined
  };

  cache.set(cacheKey, meta);
  return meta;
}

async function proxyRange(
  req: NextRequest,
  url: string,
  range: string,
  fileSize: number,
  mimeType: string
): Promise<NextResponse> {
  const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
  if (!rangeMatch) {
    return NextResponse.json({ error: 'Invalid range header' }, { status: 416 });
  }

  const start = parseInt(rangeMatch[1]);
  const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : fileSize - 1;
  
  if (start >= fileSize || end >= fileSize || start > end) {
    return NextResponse.json({ error: 'Range not satisfiable' }, { status: 416 });
  }

  const upstream = await fetch(url, {
    headers: {
      'Range': `bytes=${start}-${end}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    signal: req.signal
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Upstream range request failed: ${upstream.status}`);
  }

  const headers = new Headers({
    'Content-Type': mimeType,
    'Content-Length': `${end - start + 1}`,
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600'
  });

  return new NextResponse(upstream.body, { 
    status: 206, 
    headers 
  });
}

async function remuxToMp4Stream(
  req: NextRequest,
  url: string,
  cacheKey: string,
  transcodeVideo: boolean
): Promise<NextResponse> {
  const upstream = await axios.get<Readable>(url, {
    responseType: 'stream',
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    signal: req.signal,
    validateStatus: status => status >= 200 && status < 300
  });

  if (!upstream.data) {
    throw new Error(`Upstream fetch failed: ${upstream.status}`);
  }

  const inputStream = upstream.data;
  const outputStream = new PassThrough({ highWaterMark: 64 * 1024 }); // 64KB buffer

  const videoOutputArgs = transcodeVideo
    ? [
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p'
      ]
    : ['-c:v', 'copy'];

  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts',
    '-i', 'pipe:0',
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-sn',
    ...videoOutputArgs,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
    '-f', 'mp4',
    '-avoid_negative_ts', 'make_zero',
    'pipe:1'
  ], { 
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  // Track active streams for cleanup
  if (!activeStreams.has(cacheKey)) {
    activeStreams.set(cacheKey, new Set());
  }
  activeStreams.get(cacheKey)!.add(ffmpeg);

  let stopped = false;
  let released = false;
  let forceKillTimer: NodeJS.Timeout | null = null;

  // An interrupted input makes FFmpeg report a truncated file while it exits.
  // That is expected after a browser cancels preload/playback, so only report
  // FFmpeg diagnostics while the stream is still meant to be active.
  ffmpeg.stderr.on('data', (data: Buffer) => {
    if (stopped) return;

    const error = data.toString();
    if (error.includes('Error') || error.includes('Failed')) {
      console.error(`FFmpeg error for ${cacheKey}:`, error);
    }
  });

  const release = () => {
    if (released) return;
    released = true;
    req.signal.removeEventListener('abort', handleClientDisconnect);

    const streams = activeStreams.get(cacheKey);
    if (streams) {
      streams.delete(ffmpeg);
      if (streams.size === 0) activeStreams.delete(cacheKey);
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    release();

    inputStream.unpipe(ffmpeg.stdin);
    ffmpeg.stdout.unpipe(outputStream);

    if (!inputStream.destroyed) inputStream.destroy();
    if (!ffmpeg.stdin.destroyed) ffmpeg.stdin.destroy();
    if (!ffmpeg.stdout.destroyed) ffmpeg.stdout.destroy();
    if (!outputStream.destroyed) outputStream.destroy();

    if (!ffmpeg.killed) {
      ffmpeg.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (ffmpeg.exitCode === null) ffmpeg.kill('SIGKILL');
      }, 5000);
      forceKillTimer.unref();
    }
  };

  function handleClientDisconnect() {
    console.log('Client disconnected, cleaning up stream');
    stop();
  }

  const handlePipelineError = (label: string, error: NodeJS.ErrnoException | null) => {
    if (!error || stopped) return;

    if (!['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE', 'EPIPE', 'ERR_CANCELED'].includes(error.code || '')) {
      console.error(`${label} pipeline error:`, error);
    }
    stop();
  };

  req.signal.addEventListener('abort', handleClientDisconnect, { once: true });

  pipeline(inputStream, ffmpeg.stdin, error => {
    handlePipelineError('Input', error);
  });

  pipeline(ffmpeg.stdout, outputStream, error => {
    handlePipelineError('Output', error);
  });

  ffmpeg.once('error', error => {
    if (!stopped) console.error('FFmpeg process error:', error);
    stop();
  });

  ffmpeg.once('close', code => {
    if (forceKillTimer) clearTimeout(forceKillTimer);
    release();

    if (!stopped && code !== 0) {
      console.error(`FFmpeg exited with code ${code} for ${cacheKey}`);
      if (!outputStream.destroyed) outputStream.destroy();
    }
  });

  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'none',
    'X-Video-Mode': transcodeVideo ? 'transcode-h264' : 'remux',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store'
  });

  // Convert explicitly before constructing the Fetch response. Passing a Node
  // stream directly makes Undici wrap its async iterator; a simultaneous client
  // cancel and Node stream close can then call controller.close() twice.
  const responseBody = Readable.toWeb(outputStream) as ReadableStream<Uint8Array>;
  return new NextResponse(responseBody, { status: 200, headers });
}

// Cleanup function for graceful shutdown
async function cleanup() {
  console.log('Cleaning up active streams...');
  activeStreams.forEach((streams, cacheKey) => {
    streams.forEach((ffmpeg) => {
      try {
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM');
        }
      } catch (err) {
        console.error(`Error killing FFmpeg process for ${cacheKey}:`, err);
      }
    });
  });
  activeStreams.clear();
  cache.clear();
}

// Set up cleanup on process exit
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
