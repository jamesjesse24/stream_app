import { spawn, type ChildProcess } from 'child_process';
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
const SEGMENT_WAIT_MS = 12 * 60 * 1000;
const FILE_POLL_MS = 150;
const SEGMENT_DURATION_SECONDS = 4;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const SESSION_PATTERN = /^[a-f0-9]{32}$/;
const ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

interface SubtitleTrack {
  inputIndex: number;
  language: string;
  name: string;
}

interface LinearSession {
  id: string;
  key: string;
  sourceUrl: string;
  transcode: boolean;
  directory: string;
  playlistPath: string;
  masterPlaylistPath: string;
  controller: AbortController;
  process: ChildProcess | null;
  startedAt: number;
  lastAccess: number;
  finished: boolean;
  exitCode: number | null;
  error: Error | null;
  stderr: string;
  durationSeconds: number | null;
  generatedSeconds: number;
  subtitleTrack: SubtitleTrack | null;
  startPromise: Promise<void>;
}

interface LinearStore {
  sessions: Map<string, LinearSession>;
  cleanupTimer?: NodeJS.Timeout;
}

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  tags?: {
    language?: string;
    title?: string;
  };
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
    if (session.subtitleTrack) {
      await waitForAsset(session, 'master.m3u8', PLAYLIST_WAIT_MS);
      return genericPlaylistResponse(session, 'master.m3u8');
    }
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

  if (asset.endsWith('.m3u8')) {
    await waitForAsset(session, asset, PLAYLIST_WAIT_MS);
    return asset === 'stream.m3u8'
      ? playlistResponse(session)
      : genericPlaylistResponse(session, asset);
  }

  await waitForAsset(session, asset, SEGMENT_WAIT_MS);
  const assetPath = safeAssetPath(session, asset);
  const info = await stat(assetPath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_ASSET_BYTES) {
    throw new HttpError(502, 'Generated stream asset is invalid');
  }

  const body = await readFile(assetPath);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Length': String(body.byteLength),
      'Content-Type': contentTypeForAsset(asset),
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
  const key = `linear-v2\0${transcode ? 'transcode' : 'copy'}\0${sourceUrl}`;
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
    masterPlaylistPath: path.join(directory, 'master.m3u8'),
    controller: new AbortController(),
    process: null,
    startedAt: Date.now(),
    lastAccess: Date.now(),
    finished: false,
    exitCode: null,
    error: null,
    stderr: '',
    durationSeconds: null,
    generatedSeconds: 0,
    subtitleTrack: null,
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

  session.subtitleTrack = await probePreferredSubtitle(session.sourceUrl);

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

  const mapArgs = ['-map', '0:v:0', '-map', '0:a:0?'];
  if (session.subtitleTrack) {
    mapArgs.push('-map', `0:${session.subtitleTrack.inputIndex}`);
  }

  const subtitleArgs = session.subtitleTrack
    ? [
        '-c:s',
        'webvtt',
        '-var_stream_map',
        `v:0,a:0,s:0,sgroup:subs,language:${hlsToken(session.subtitleTrack.language)}`,
        '-master_pl_name',
        'master.m3u8',
        '-master_pl_publish_rate',
        '1',
      ]
    : [];

  const args = [
    '-hide_banner',
    '-loglevel',
    process.env.STREAM_DEBUG === '1' ? 'info' : 'warning',
    '-y',
    '-fflags',
    '+genpts',
    '-i',
    'pipe:0',
    ...mapArgs,
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
    ...subtitleArgs,
    session.playlistPath,
  ];

  if (process.env.STREAM_DEBUG === '1') {
    console.log('[stream-linear] starting', {
      session: session.id,
      mode: session.transcode ? 'transcode' : 'copy',
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      subtitle: session.subtitleTrack,
      ffmpeg,
    });
  }

  const child = spawn(ffmpeg, args, {
    cwd: session.directory,
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  session.process = child;

  const stderr = child.stderr;
  const stdin = child.stdin;
  if (!stderr || !stdin) {
    child.kill('SIGKILL');
    throw new Error('FFmpeg did not expose the required input and error streams');
  }

  stderr.setEncoding('utf8');
  stderr.on('data', (chunk: string) => {
    const text = String(chunk);
    session.stderr = `${session.stderr}${text}`.slice(-16000);
    captureLinearProgress(session);
    if (process.env.STREAM_DEBUG === '1') {
      text
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => console.log(`[stream-linear][ffmpeg][${session.id}] ${line}`));
    }
  });

  const sourceStream = Readable.fromWeb(response.body as any);
  sourceStream.on('error', (error) => {
    session.error = toError(error);
    stdin.destroy(error);
  });
  stdin.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EPIPE') session.error = toError(error);
  });
  sourceStream.pipe(stdin);

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

async function probePreferredSubtitle(sourceUrl: string): Promise<SubtitleTrack | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  timeout.unref();
  const ffprobe = process.env.FFPROBE_PATH || process.env.FFPROBE_BIN || 'ffprobe';

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'video/*,*/*;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': USER_AGENT,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;

    const child = spawn(
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=index,codec_type,codec_name:stream_tags=language,title',
        '-of',
        'json',
        'pipe:0',
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdin || !stdout || !stderr) {
      child.kill('SIGKILL');
      return null;
    }

    let output = '';
    let errorOutput = '';
    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      if (output.length < 1024 * 1024) output += String(chunk);
    });
    stderr.on('data', (chunk: string) => {
      if (errorOutput.length < 64 * 1024) errorOutput += String(chunk);
    });

    const sourceStream = Readable.fromWeb(response.body as any);
    sourceStream.on('error', () => stdin.destroy());
    stdin.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE' && process.env.STREAM_DEBUG === '1') {
        console.warn('[stream-linear] ffprobe input pipe failed:', error);
      }
    });
    sourceStream.pipe(stdin);

    const code = await new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(-1));
      child.once('close', resolve);
    });
    controller.abort();
    sourceStream.destroy();

    if (code !== 0) {
      if (process.env.STREAM_DEBUG === '1') {
        console.warn('[stream-linear] ffprobe subtitle scan failed', {
          code,
          details: errorOutput.slice(-2000),
        });
      }
      return null;
    }

    const parsed = JSON.parse(output) as { streams?: ProbeStream[] };
    const candidates = (parsed.streams ?? []).filter(isTextSubtitleStream);
    if (candidates.length === 0) return null;

    const preferred =
      candidates.find((stream) => /^(?:eng|en)$/i.test(stream.tags?.language ?? '')) ??
      candidates[0];
    if (!Number.isSafeInteger(preferred.index)) return null;

    const language = normalizeLanguage(preferred.tags?.language);
    return {
      inputIndex: preferred.index!,
      language,
      name: subtitleDisplayName(language, preferred.tags?.title),
    };
  } catch (error) {
    if (process.env.STREAM_DEBUG === '1') {
      console.warn('[stream-linear] built-in subtitle scan unavailable:', error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function isTextSubtitleStream(stream: ProbeStream): boolean {
  if (stream.codec_type !== 'subtitle' || !Number.isSafeInteger(stream.index)) return false;
  const codec = (stream.codec_name ?? '').toLowerCase();
  return ![
    'hdmv_pgs_subtitle',
    'dvd_subtitle',
    'dvb_subtitle',
    'xsub',
  ].includes(codec);
}

function normalizeLanguage(value: string | undefined): string {
  const language = (value ?? '').trim().toLowerCase();
  if (language === 'en') return 'eng';
  return /^[a-z]{2,3}$/.test(language) ? language : 'und';
}

function subtitleDisplayName(language: string, title: string | undefined): string {
  const cleanedTitle = title?.trim();
  if (cleanedTitle) return cleanedTitle;
  const names: Record<string, string> = {
    eng: 'English',
    chi: 'Chinese',
    zho: 'Chinese',
    ara: 'Arabic',
    ger: 'German',
    deu: 'German',
    spa: 'Spanish',
    fre: 'French',
    fra: 'French',
    ind: 'Indonesian',
    ita: 'Italian',
    may: 'Malay',
    msa: 'Malay',
    por: 'Portuguese',
    rus: 'Russian',
    tha: 'Thai',
    vie: 'Vietnamese',
  };
  return names[language] ?? language.toUpperCase();
}

function hlsToken(value: string): string {
  const token = value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return token || 'Subtitle';
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
      // FFmpeg has not published this asset yet.
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

function clockToSeconds(hours: string, minutes: string, seconds: string): number {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function captureLinearProgress(session: LinearSession): void {
  if (session.durationSeconds === null) {
    const durationMatch = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(
      session.stderr,
    );
    if (durationMatch) {
      const duration = clockToSeconds(durationMatch[1], durationMatch[2], durationMatch[3]);
      if (Number.isFinite(duration) && duration > 0) session.durationSeconds = duration;
    }
  }

  const progressPattern = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g;
  let progressMatch: RegExpExecArray | null = null;
  let latestProgress: RegExpExecArray | null = null;
  while ((progressMatch = progressPattern.exec(session.stderr)) !== null) {
    latestProgress = progressMatch;
  }
  if (latestProgress) {
    const generated = clockToSeconds(
      latestProgress[1],
      latestProgress[2],
      latestProgress[3],
    );
    if (Number.isFinite(generated) && generated > session.generatedSeconds) {
      session.generatedSeconds = generated;
    }
  }
}

function parsePublishedSegmentDurations(source: string): Map<number, number> {
  const durations = new Map<number, number>();
  let pendingDuration: number | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const durationMatch = /^#EXTINF:([0-9.]+)/.exec(line);
    if (durationMatch) {
      const value = Number(durationMatch[1]);
      pendingDuration = Number.isFinite(value) && value > 0 ? value : null;
      continue;
    }

    const segmentMatch = /^segment-(\d{6})\.ts$/.exec(line);
    if (segmentMatch) {
      const index = Number(segmentMatch[1]);
      if (Number.isSafeInteger(index) && pendingDuration !== null) {
        durations.set(index, pendingDuration);
      }
      pendingDuration = null;
    }
  }

  return durations;
}

function createFullTimelinePlaylist(session: LinearSession, source: string): string {
  const duration = session.durationSeconds;
  if (!(duration && Number.isFinite(duration) && duration > 0)) {
    return rewritePlaylistAssets(session, source);
  }

  const publishedDurations = parsePublishedSegmentDurations(source);
  const segmentCount = Math.max(1, Math.ceil(duration / SEGMENT_DURATION_SECONDS));
  let publishedMaximum = 0;
  publishedDurations.forEach((value) => {
    publishedMaximum = Math.max(publishedMaximum, value);
  });
  const targetDuration = Math.max(
    SEGMENT_DURATION_SECONDS,
    Math.ceil(publishedMaximum || SEGMENT_DURATION_SECONDS),
  );
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];

  for (let index = 0; index < segmentCount; index += 1) {
    const remaining = duration - index * SEGMENT_DURATION_SECONDS;
    const fallbackDuration = Math.max(
      0.001,
      Math.min(SEGMENT_DURATION_SECONDS, remaining),
    );
    const segmentDuration = publishedDurations.get(index) ?? fallbackDuration;
    const asset = `segment-${String(index).padStart(6, '0')}.ts`;
    lines.push(`#EXTINF:${segmentDuration.toFixed(6)},`);
    lines.push(assetUrl(session, asset));
  }

  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

async function playlistResponse(session: LinearSession): Promise<NextResponse> {
  const source = await readFile(session.playlistPath, 'utf8');
  const playlist = createFullTimelinePlaylist(session, source);
  return playlistResponseWithHeaders(session, playlist);
}

async function genericPlaylistResponse(
  session: LinearSession,
  asset: string,
): Promise<NextResponse> {
  const source = await readFile(safeAssetPath(session, asset), 'utf8');
  return playlistResponseWithHeaders(session, rewritePlaylistAssets(session, source));
}

function playlistResponseWithHeaders(
  session: LinearSession,
  playlist: string,
): NextResponse {
  return new NextResponse(playlist, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'X-Accel-Buffering': 'no',
      'X-Linear-Mode': session.transcode ? 'transcode' : 'copy',
      'X-Linear-Session': session.id,
      'X-Linear-Duration': String(session.durationSeconds ?? 0),
      'X-Linear-Generated': String(session.generatedSeconds),
      'X-Linear-Subtitle': session.subtitleTrack?.name ?? '',
    },
  });
}

function rewritePlaylistAssets(session: LinearSession, source: string): string {
  const withAttributeUris = source.replace(/URI="([^"]+)"/g, (_match, asset: string) => {
    return `URI="${rewriteGeneratedAsset(session, asset)}"`;
  });

  return withAttributeUris
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      return rewriteGeneratedAsset(session, trimmed);
    })
    .join('\n');
}

function rewriteGeneratedAsset(session: LinearSession, value: string): string {
  if (/^(?:https?:|data:|blob:|\/api\/)/i.test(value)) return value;
  const asset = value.replace(/^\.\//, '');
  if (!ASSET_PATTERN.test(asset)) {
    throw new HttpError(502, `FFmpeg generated an unsafe playlist asset: ${value}`);
  }
  return assetUrl(session, asset);
}

function assetUrl(session: LinearSession, asset: string): string {
  return `/api/playback-linear?session=${encodeURIComponent(session.id)}&asset=${encodeURIComponent(asset)}`;
}

function contentTypeForAsset(asset: string): string {
  if (asset.endsWith('.vtt')) return 'text/vtt; charset=utf-8';
  if (asset.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl; charset=utf-8';
  return 'video/mp2t';
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
