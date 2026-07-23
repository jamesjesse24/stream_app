import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, readFile, rm, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_ROOT = path.resolve(process.cwd(), '.hls-linear-cache');
const SESSION_IDLE_MS = 20 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const PLAYLIST_WAIT_MS = 45 * 1000;
const SEGMENT_WAIT_MS = 180 * 1000;
const FILE_POLL_MS = 150;
const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
const SESSION_PATTERN = /^[a-f0-9]{32}$/;
const ASSET_PATTERN = /^(?:stream\.m3u8|segment-\d{6}\.ts)$/;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

interface LinearSession {
  id: string;
  key: string;
  sourceUrl: string;
  transcode: boolean;
  directory: string;
  playlistPath: string;
  controller: AbortController;
  process: ChildProcessWithoutNullStreams | null;
  startedAt: number;
  lastAccess: number;
  finished: boolean;
  exitCode: number | null;
  error: Error | null;
  stderr: string;
  startPromise: Promise<void>;
}

interface LinearStore {
  sessions: Map<string, LinearSession>;
  cleanupTimer?: NodeJS.Timeout;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const globalWithLinearSessions = globalThis as typeof globalThis & {
  __uhdLinearSessionStore?: LinearStore;
};

const store =
  globalWithLinearSessions.__uhdLinearSessionStore ??
  (globalWithLinearSessions.__uhdLinearSessionStore = {
    sessions: new Map<string, LinearSession>(),
  });

if (!store.cleanupTimer) {
  store.cleanupTimer = setInterval(() => {
    void cleanupIdleSessions();
  }, CLEANUP_INTERVAL_MS);
  store.cleanupTimer.unref();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessionId = request.nextUrl.searchParams.get('session');
  const asset = request.nextUrl.searchParams.get('asset');

  try {
    if (sessionId !== null || asset !== null) {
      return await serveAsset(sessionId, asset);
    }

    const sourceValue = request.nextUrl.searchParams.get('url');
    if (!sourceValue) throw new HttpError(400, 'Missing url parameter');

    const transcodeValue = request.nextUrl.searchParams.get('transcode');
    if (transcodeValue !== null && transcodeValue !== '0' && transcodeValue !== '1') {
      throw new HttpError(400, 'transcode must be either 0 or 1');
    }

    const sourceUrl = validateSourceUrl(sourceValue);
    const transcode = transcodeValue === '1';
    const session = await getOrCreateSession(sourceUrl, transcode);
    session.lastAccess = Date.now();

    await waitForAsset(session, 'stream.m3u8', PLAYLIST_WAIT_MS);
    return playlistResponse(session);
  } catch (error) {
    return errorResponse(error, 'Failed to create sequential playback stream');
  }
}

async function serveAsset(
  sessionId: string | null,
  asset: string | null,
): Promise<NextResponse> {
  if (!sessionId || !SESSION_PATTERN.test(sessionId)) {
    throw new HttpError(400, 'Invalid session identifier');
  }
  if (!asset || !ASSET_PATTERN.test(asset)) {
    throw new HttpError(400, 'Invalid stream asset');
  }

  const session = store.sessions.get(sessionId);
  if (!session) throw new HttpError(404, 'Sequential playback session not found');
  session.lastAccess = Date.now();

  if (asset === 'stream.m3u8') {
    await waitForAsset(session, asset, PLAYLIST_WAIT_MS);
    return playlistResponse(session);
  }

  await waitForAsset(session, asset, SEGMENT_WAIT_MS);
  const assetPath = safeAssetPath(session, asset);
  const info = await stat(assetPath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_SEGMENT_BYTES) {
    throw new HttpError(502, 'Generated segment is invalid');
  }

  const body = await readFile(assetPath);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Length': String(body.byteLength),
      'Content-Type': 'video/mp2t',
      'X-Accel-Buffering': 'no',
      'X-Linear-Session': session.id,
    },
  });
}

function validateSourceUrl(value: string): string {
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    throw new HttpError(400, 'url must be a valid absolute URL');
  }

  if (source.protocol !== 'https:') {
    throw new HttpError(400, 'Only HTTPS source URLs are supported');
  }
  if (source.username || source.password) {
    throw new HttpError(400, 'URLs containing credentials are not supported');
  }

  const host = source.hostname.toLowerCase();
  const trusted =
    host === 'video-downloads.googleusercontent.com' ||
    host.endsWith('.video-downloads.googleusercontent.com') ||
    host === 'cdn.video-plex.xyz';
  if (!trusted) throw new HttpError(403, 'Only trusted video CDN URLs are permitted');

  return source.toString();
}

async function getOrCreateSession(
  sourceUrl: string,
  transcode: boolean,
): Promise<LinearSession> {
  const key = `linear-v1\0${transcode ? 'transcode' : 'copy'}\0${sourceUrl}`;
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32);
  const existing = store.sessions.get(id);

  if (existing) {
    existing.lastAccess = Date.now();
    if (existing.error || (existing.finished && existing.exitCode !== 0)) {
      await cleanupSession(existing);
    } else {
      return existing;
    }
  }

  const directory = path.resolve(CACHE_ROOT, id);
  const session: LinearSession = {
    id,
    key,
    sourceUrl,
    transcode,
    directory,
    playlistPath: path.join(directory, 'stream.m3u8'),
    controller: new AbortController(),
    process: null,
    startedAt: Date.now(),
    lastAccess: Date.now(),
    finished: false,
    exitCode: null,
    error: null,
    stderr: '',
    startPromise: Promise.resolve(),
  };

  store.sessions.set(id, session);
  session.startPromise = startSession(session).catch((error) => {
    session.error = toError(error);
    throw error;
  });
  void session.startPromise.catch(() => undefined);
  return session;
}

async function startSession(session: LinearSession): Promise<void> {
  await rm(session.directory, { recursive: true, force: true });
  await mkdir(session.directory, { recursive: true });

  const response = await fetch(session.sourceUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Accept: 'video/*,*/*;q=0.9',
      'Accept-Encoding': 'identity',
      'User-Agent': USER_AGENT,
    },
    cache: 'no-store',
    signal: session.controller.signal,
  });

  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(
      502,
      `Source download failed with HTTP ${response.status} ${response.statusText}`,
    );
  }

  const ffmpeg = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg';
  const videoArgs = session.transcode
    ? [
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-force_key_frames',
        'expr:gte(t,n_forced*4)',
        '-sc_threshold',
        '0',
      ]
    : ['-c:v', 'copy'];

  const args = [
    '-hide_banner',
    '-loglevel',
    process.env.STREAM_DEBUG === '1' ? 'info' : 'warning',
    '-y',
    '-fflags',
    '+genpts',
    '-i',
    'pipe:0',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    ...videoArgs,
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '128k',
    '-max_muxing_queue_size',
    '2048',
    '-avoid_negative_ts',
    'make_zero',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    '-hls_segment_type',
    'mpegts',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_segment_filename',
    path.join(session.directory, 'segment-%06d.ts'),
    session.playlistPath,
  ];

  if (process.env.STREAM_DEBUG === '1') {
    console.log('[stream-linear] starting', {
      session: session.id,
      mode: session.transcode ? 'transcode' : 'copy',
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      ffmpeg,
    });
  }

  const child = spawn(ffmpeg, args, {
    cwd: session.directory,
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  session.process = child;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    session.stderr = `${session.stderr}${chunk}`.slice(-16000);
    if (process.env.STREAM_DEBUG === '1') {
      chunk
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => console.log(`[stream-linear][ffmpeg][${session.id}] ${line}`));
    }
  });

  const sourceStream = Readable.fromWeb(
    response.body as unknown as import('stream/web').ReadableStream<Uint8Array>,
  );
  sourceStream.on('error', (error) => {
    session.error = toError(error);
    child.stdin.destroy(error);
  });
  child.stdin.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EPIPE') session.error = toError(error);
  });
  sourceStream.pipe(child.stdin);

  child.once('error', (error) => {
    session.error = toError(error);
    session.finished = true;
    session.exitCode = -1;
    session.controller.abort(error);
  });

  child.once('close', (code) => {
    session.finished = true;
    session.exitCode = code;
    session.process = null;
    sourceStream.destroy();
    if (code !== 0 && !session.error) {
      session.error = new Error(
        `FFmpeg exited with code ${code}: ${session.stderr.trim().split(/\r?\n/).slice(-8).join('\n')}`,
      );
    }
    if (process.env.STREAM_DEBUG === '1') {
      console.log('[stream-linear] finished', {
        session: session.id,
        code,
        error: session.error?.message ?? null,
      });
    }
  });
}

async function waitForAsset(
  session: LinearSession,
  asset: string,
  timeoutMs: number,
): Promise<void> {
  const assetPath = safeAssetPath(session, asset);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const info = await stat(assetPath);
      if (info.isFile() && info.size > 0) return;
    } catch {
      // The sequential encoder has not published this asset yet.
    }

    if (session.error) throw session.error;
    if (session.finished && session.exitCode !== 0) {
      throw new HttpError(502, `Sequential FFmpeg failed: ${session.stderr.slice(-4000)}`);
    }
    await delay(FILE_POLL_MS);
  }

  throw new HttpError(
    504,
    `Timed out waiting for ${asset}; sequential startup may be too slow or FFmpeg may be unavailable`,
  );
}

async function playlistResponse(session: LinearSession): Promise<NextResponse> {
  const source = await readFile(session.playlistPath, 'utf8');
  const rewritten = source.replace(
    /^(segment-\d{6}\.ts)$/gm,
    (_match, asset: string) =>
      `/api/playback-linear?session=${encodeURIComponent(session.id)}&asset=${encodeURIComponent(asset)}`,
  );

  return new NextResponse(rewritten, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'X-Accel-Buffering': 'no',
      'X-Linear-Mode': session.transcode ? 'transcode' : 'copy',
      'X-Linear-Session': session.id,
    },
  });
}

function safeAssetPath(session: LinearSession, asset: string): string {
  if (!ASSET_PATTERN.test(asset)) throw new HttpError(400, 'Invalid stream asset');
  const resolved = path.resolve(session.directory, asset);
  if (path.dirname(resolved) !== session.directory) {
    throw new HttpError(400, 'Invalid stream asset path');
  }
  return resolved;
}

async function cleanupIdleSessions(): Promise<void> {
  const now = Date.now();
  const expired = Array.from(store.sessions.values()).filter(
    (session) => now - session.lastAccess > SESSION_IDLE_MS,
  );
  await Promise.all(expired.map((session) => cleanupSession(session)));
}

async function cleanupSession(session: LinearSession): Promise<void> {
  if (store.sessions.get(session.id) !== session) return;
  store.sessions.delete(session.id);
  session.controller.abort();
  if (session.process && !session.process.killed) {
    try {
      session.process.kill('SIGTERM');
    } catch {
      // The process may have exited between the check and kill call.
    }
  }
  await rm(session.directory, { recursive: true, force: true }).catch(() => undefined);
}

function errorResponse(error: unknown, fallback: string): NextResponse {
  const status = error instanceof HttpError ? error.status : 500;
  const details = error instanceof Error ? error.message : String(error);
  console.error(`[stream-linear] ${fallback}:`, error);
  return NextResponse.json(
    {
      error: status >= 500 ? fallback : details,
      details,
    },
    { status },
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
