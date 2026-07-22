import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  registerParallelRangeSource,
  unregisterParallelRangeSource,
} from '../../../lib/parallel-range-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PIPELINE_VERSION = 'seekable-ts-vod-v5';
const CACHE_ROOT = path.resolve(process.cwd(), '.hls-vod-cache');
const SEGMENT_DURATION_SECONDS = 4;
const AV_WINDOW_SEGMENTS = 3;
const MAX_ACTIVE_AV_JOBS = 2;
const MAX_ACTIVE_SUBTITLE_JOBS = 1;
const MAX_TRACKS_PER_TYPE = 9;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 8 * 1024 * 1024;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const SOURCE_PROBE_TIMEOUT_MS = 20 * 1000;
const FFPROBE_TIMEOUT_MS = 60 * 1000;
const FFMPEG_AV_TIMEOUT_MS = 120 * 1000;
const FFMPEG_SUBTITLE_TIMEOUT_MS = 120 * 1000;
const ASSET_WAIT_TIMEOUT_MS = 135 * 1000;
const FFPROBE_MAX_OUTPUT_BYTES = 1024 * 1024;
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/;
const MASTER_PLAYLIST_NAME = 'master.m3u8';
const STREAM_PLAYLIST_PATTERN = /^stream-([0-9])\.m3u8$/;
const AV_SEGMENT_PATTERN = /^segment-([0-9])-(\d{6})\.ts$/;
const SUBTITLE_PLAYLIST_PATTERN = /^subtitle-([0-8])\.m3u8$/;
const SUBTITLE_SEGMENT_PATTERN = /^subtitle-([0-8])-(\d{6})\.vtt$/;
const ASSET_NAME_PATTERN = /^(?:master\.m3u8|stream-[0-9]\.m3u8|segment-[0-9]-\d{6}\.ts|subtitle-[0-8]\.m3u8|subtitle-[0-8]-\d{6}\.vtt)$/;
const SUPPORTED_SUBTITLE_CODECS = new Set([
  'subrip',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
]);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface MediaTrack {
  relativeIndex: number;
  codecName: string | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
}

interface MediaInfo {
  duration: number;
  segmentCount: number;
  videoCodecName: string;
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
  warnings: string[];
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  duration?: string | number;
  tags?: Record<string, unknown>;
  disposition?: Record<string, unknown>;
}

interface FfprobeResult {
  streams?: FfprobeStream[];
  format?: {
    duration?: string | number;
  };
}

interface AvJob {
  startIndex: number;
  endIndex: number;
  outputPrefix: string;
  cancel: ((error: Error) => void) | null;
  waiters: number;
  process: ChildProcess | null;
  promise: Promise<void>;
  finished: boolean;
  error: Error | null;
  stderr: string;
}

interface SubtitleJob {
  key: string;
  cancel: ((error: Error) => void) | null;
  waiters: number;
  process: ChildProcess | null;
  promise: Promise<void>;
  finished: boolean;
  error: Error | null;
  stderr: string;
}

interface VodSession {
  id: string;
  key: string;
  sourceUrl: string;
  proxyUrl: string | null;
  sourceLength: number | null;
  transcode: boolean;
  directory: string;
  mediaInfo: MediaInfo | null;
  initializePromise: Promise<void>;
  initializeError: Error | null;
  abortController: AbortController;
  avJobs: Map<number, AvJob>;
  subtitleJobs: Map<string, SubtitleJob>;
  lastAccess: number;
  closing: boolean;
  cleanupPromise?: Promise<void>;
}

interface VodSessionStore {
  sessions: Map<string, VodSession>;
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

const globalWithVodSessions = globalThis as typeof globalThis & {
  __uhdVodSessionStore?: VodSessionStore;
};

const sessionStore =
  globalWithVodSessions.__uhdVodSessionStore ??
  (globalWithVodSessions.__uhdVodSessionStore = {
    sessions: new Map<string, VodSession>(),
  });

if (!sessionStore.cleanupTimer) {
  sessionStore.cleanupTimer = setInterval(() => {
    void removeIdleSessions();
  }, CLEANUP_INTERVAL_MS);
  sessionStore.cleanupTimer.unref();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessionId = request.nextUrl.searchParams.get('session');
  const assetName = request.nextUrl.searchParams.get('asset');

  if (sessionId !== null || assetName !== null) {
    return serveAsset(sessionId, assetName, request.signal);
  }

  const sourceValue = request.nextUrl.searchParams.get('url');
  if (!sourceValue) {
    return jsonError(400, 'Missing url parameter');
  }

  const transcodeValue = request.nextUrl.searchParams.get('transcode');
  if (transcodeValue !== null && transcodeValue !== '0' && transcodeValue !== '1') {
    return jsonError(400, 'transcode must be either 0 or 1');
  }

  try {
    const sourceUrl = validateSourceUrl(sourceValue);
    // transcode=0 is a fast video-copy remux for browser-compatible H.264
    // sources. transcode=1 retains the accurate encode path for unsupported
    // codecs and sources whose keyframe layout cannot be played directly.
    const shouldTranscode = transcodeValue !== '0';
    const session = await getOrCreateSession(sourceUrl, shouldTranscode);
    await requireInitializedSession(session);
    session.lastAccess = Date.now();

    return playlistResponse(
      createMasterPlaylist(session),
      session.id,
      false,
      session.mediaInfo,
    );
  } catch (error) {
    return errorResponse(error, 'Failed to create seekable playback session');
  }
}

function validateSourceUrl(value: string): string {
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    throw new HttpError(400, 'url must be a valid absolute URL');
  }

  if (source.protocol !== 'http:' && source.protocol !== 'https:') {
    throw new HttpError(400, 'Only http and https source URLs are supported');
  }
  if (source.username || source.password) {
    throw new HttpError(400, 'Source URLs containing credentials are not supported');
  }

  return source.toString();
}

async function getOrCreateSession(
  sourceUrl: string,
  transcode: boolean,
): Promise<VodSession> {
  const key = `${PIPELINE_VERSION}\0${transcode ? 'transcode' : 'copy'}\0${sourceUrl}`;
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32);

  while (true) {
    const existing = sessionStore.sessions.get(id);
    if (existing) {
      if (existing.key !== key) {
        throw new HttpError(500, 'Playback session identifier collision');
      }
      if (existing.closing) {
        await existing.cleanupPromise;
        continue;
      }
      existing.lastAccess = Date.now();
      return existing;
    }

    const directory = getSessionDirectory(id);
    const session: VodSession = {
      id,
      key,
      sourceUrl,
      proxyUrl: null,
      sourceLength: null,
      transcode,
      directory,
      mediaInfo: null,
      initializePromise: Promise.resolve(),
      initializeError: null,
      abortController: new AbortController(),
      avJobs: new Map<number, AvJob>(),
      subtitleJobs: new Map<string, SubtitleJob>(),
      lastAccess: Date.now(),
      closing: false,
    };

    // Publish the record before the first await so simultaneous manifest
    // requests share the same range check and ffprobe process.
    sessionStore.sessions.set(id, session);
    session.initializePromise = initializeSession(session).catch((error) => {
      session.initializeError = toError(error);
      // Remote worker URLs can fail transiently. Do not permanently poison the
      // deterministic session key; the next manifest request should perform a
      // fresh range check and probe.
      if (sessionStore.sessions.get(id) === session) {
        sessionStore.sessions.delete(id);
      }
      throw error;
    });
    void session.initializePromise.catch(() => undefined);
    return session;
  }
}

async function initializeSession(session: VodSession): Promise<void> {
  assertSafeSessionDirectory(session.directory, session.id);
  await rm(session.directory, { recursive: true, force: true });
  await mkdir(session.directory, { recursive: true });

  const rangeLength = await verifyByteRangeSupport(
    session.sourceUrl,
    session.abortController.signal,
  );

  if (!Number.isSafeInteger(rangeLength) || rangeLength <= 0) {
    throw new HttpError(502, 'The source reported an invalid byte length');
  }
  session.sourceLength = rangeLength;

  try {
    session.proxyUrl = await registerParallelRangeSource(
      session.id,
      session.sourceUrl,
      rangeLength,
      USER_AGENT,
    );
    // Probe through the same bounded, cached range transport used by FFmpeg.
    // This warms Matroska header/footer/cue blocks for every later cold seek.
    const mediaInfo = await probeMediaInfo(
      session.proxyUrl,
      session.abortController.signal,
    );

    if (!session.transcode && mediaInfo.videoCodecName !== 'h264') {
      throw new HttpError(
        422,
        `The source video codec is ${mediaInfo.videoCodecName}; use transcode=1 for browser-compatible H.264`,
      );
    }
    if (session.closing || session.abortController.signal.aborted) {
      throw createAbortError('Playback session closed during initialization');
    }

    session.mediaInfo = mediaInfo;
  } catch (error) {
    unregisterParallelRangeSource(session.id);
    session.proxyUrl = null;
    session.sourceLength = null;
    throw error;
  }
}

async function requireInitializedSession(session: VodSession): Promise<MediaInfo> {
  try {
    await session.initializePromise;
  } catch (error) {
    throw session.initializeError ?? error;
  }
  if (session.closing) {
    throw new HttpError(410, 'Playback session is closing');
  }
  if (!session.mediaInfo) {
    throw new HttpError(500, 'Playback session metadata is unavailable');
  }
  return session.mediaInfo;
}

async function verifyByteRangeSupport(
  sourceUrl: string,
  parentSignal: AbortSignal,
): Promise<number> {
  const { signal, cleanup } = createTimedSignal(
    parentSignal,
    SOURCE_PROBE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Range: 'bytes=0-0',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'identity',
      },
      cache: 'no-store',
      signal,
    });

    const contentRange = response.headers.get('content-range') ?? '';
    const match = /^bytes\s+0-0\/(\d+)$/i.exec(contentRange.trim());
    const declaredLength = match ? Number(match[1]) : Number.NaN;
    const declaredChunkLength = Number(response.headers.get('content-length'));

    if (
      response.status !== 206 ||
      !Number.isSafeInteger(declaredLength) ||
      declaredLength <= 0 ||
      (!Number.isNaN(declaredChunkLength) && declaredChunkLength !== 1)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new HttpError(
        422,
        'The source does not provide reliable HTTP byte ranges, so arbitrary seeking is unavailable',
      );
    }

    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength !== 1) {
      throw new HttpError(422, 'The source returned an invalid one-byte range response');
    }
    return declaredLength;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (parentSignal.aborted) {
      throw createAbortError('Source range probing was aborted');
    }
    throw new HttpError(
      502,
      `Could not verify source byte-range support: ${formatError(error)}`,
    );
  } finally {
    cleanup();
  }
}

async function probeMediaInfo(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<MediaInfo> {
  const result = await runFfprobe(sourceUrl, signal);
  const videoStream = (result.streams ?? []).find(
    (stream) => stream.codec_type === 'video',
  );
  const videoCodecName = String(videoStream?.codec_name ?? '').toLowerCase();
  if (!videoCodecName) {
    throw new HttpError(422, 'The source contains no usable video stream');
  }

  const formatDuration = Number(result.format?.duration);
  const streamDurations = (result.streams ?? [])
    .map((stream) => Number(stream.duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  const duration =
    Number.isFinite(formatDuration) && formatDuration > 0
      ? formatDuration
      : Math.max(0, ...streamDurations);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new HttpError(422, 'FFprobe could not determine the media duration');
  }
  if (duration > MAX_DURATION_SECONDS) {
    throw new HttpError(
      422,
      `Media duration exceeds the ${MAX_DURATION_SECONDS / 3600}-hour safety limit`,
    );
  }

  const audioTracks: MediaTrack[] = [];
  const subtitleTracks: MediaTrack[] = [];
  const warnings: string[] = [];
  let audioRelativeIndex = 0;
  let subtitleRelativeIndex = 0;
  let omittedAudio = 0;
  let omittedSubtitles = 0;

  for (const stream of result.streams ?? []) {
    if (stream.codec_type === 'audio') {
      const track = createMediaTrack(stream, audioRelativeIndex++);
      if (audioTracks.length < MAX_TRACKS_PER_TYPE) {
        audioTracks.push(track);
      } else {
        omittedAudio += 1;
      }
      continue;
    }

    if (stream.codec_type === 'subtitle') {
      const relativeIndex = subtitleRelativeIndex++;
      const codecName = String(stream.codec_name ?? '').toLowerCase();
      if (!SUPPORTED_SUBTITLE_CODECS.has(codecName)) continue;
      if (subtitleTracks.length < MAX_TRACKS_PER_TYPE) {
        subtitleTracks.push(createMediaTrack(stream, relativeIndex));
      } else {
        omittedSubtitles += 1;
      }
    }
  }

  if (omittedAudio > 0) {
    warnings.push(`Ignored ${omittedAudio} audio track(s) above the track limit`);
  }
  if (omittedSubtitles > 0) {
    warnings.push(
      `Ignored ${omittedSubtitles} supported subtitle track(s) above the track limit`,
    );
  }

  const segmentCount = Math.ceil(duration / SEGMENT_DURATION_SECONDS);
  if (segmentCount < 1 || segmentCount > 999_999) {
    throw new HttpError(422, 'The media duration produces an unsafe segment count');
  }

  return {
    duration,
    segmentCount,
    videoCodecName,
    audioTracks,
    subtitleTracks,
    warnings,
  };
}

function runFfprobe(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<FfprobeResult> {
  if (signal.aborted) {
    return Promise.reject(createAbortError('Media metadata probing was aborted'));
  }

  return new Promise<FfprobeResult>((resolve, reject) => {
    const ffprobe = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-rw_timeout',
        '60000000',
        '-user_agent',
        USER_AGENT,
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_on_network_error',
        '1',
        '-reconnect_on_http_error',
        '4xx,5xx',
        '-reconnect_delay_max',
        '8',
        '-probesize',
        '10485760',
        '-analyzeduration',
        '10000000',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,duration:stream_tags=language,title:stream_disposition=default,forced',
        '-of',
        'json',
        sourceUrl,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let settled = false;
    let stdout = '';
    let stdoutBytes = 0;
    let stderr = '';

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
    };
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminateProcessTree(ffprobe, 'SIGTERM');
      reject(error);
    };
    const handleAbort = () => {
      finishError(createAbortError('Media metadata probing was aborted'));
    };
    const timeout = setTimeout(() => {
      finishError(new HttpError(504, 'FFprobe timed out while reading the source'));
    }, FFPROBE_TIMEOUT_MS);
    timeout.unref();

    signal.addEventListener('abort', handleAbort, { once: true });
    ffprobe.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > FFPROBE_MAX_OUTPUT_BYTES) {
        finishError(new HttpError(502, 'FFprobe returned too much metadata'));
        return;
      }
      stdout += chunk.toString();
    });
    ffprobe.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4096);
    });
    ffprobe.once('error', (error) => {
      finishError(new HttpError(500, `Unable to launch ffprobe: ${error.message}`));
    });
    ffprobe.once('close', (code, closeSignal) => {
      if (settled) return;
      if (code !== 0) {
        finishError(
          new HttpError(
            502,
            stderr.trim() ||
              `FFprobe exited with code ${String(code)} and signal ${String(closeSignal)}`,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as FfprobeResult;
        if (!Array.isArray(parsed.streams)) {
          throw new Error('FFprobe returned no stream list');
        }
        settled = true;
        cleanup();
        resolve(parsed);
      } catch (error) {
        finishError(
          new HttpError(502, `Could not parse FFprobe output: ${formatError(error)}`),
        );
      }
    });
  });
}

function createMediaTrack(
  stream: FfprobeStream,
  relativeIndex: number,
): MediaTrack {
  return {
    relativeIndex,
    codecName:
      typeof stream.codec_name === 'string'
        ? stream.codec_name.toLowerCase()
        : null,
    language: getTagValue(stream.tags, 'language'),
    title: getTagValue(stream.tags, 'title'),
    isDefault: isEnabledDisposition(stream.disposition?.default),
    isForced: isEnabledDisposition(stream.disposition?.forced),
  };
}

async function serveAsset(
  sessionId: string | null,
  assetName: string | null,
  requestSignal: AbortSignal,
): Promise<NextResponse> {
  try {
    if (!sessionId || !assetName) {
      throw new HttpError(400, 'Both session and asset parameters are required');
    }
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new HttpError(400, 'Invalid session identifier');
    }
    if (!ASSET_NAME_PATTERN.test(assetName)) {
      throw new HttpError(400, 'Invalid VOD asset name');
    }

    const session = sessionStore.sessions.get(sessionId);
    if (!session || session.closing) {
      throw new HttpError(404, 'Playback session not found');
    }
    const mediaInfo = await requireInitializedSession(session);
    session.lastAccess = Date.now();

    if (assetName === MASTER_PLAYLIST_NAME) {
      return playlistResponse(
        createMasterPlaylist(session),
        session.id,
        true,
        mediaInfo,
      );
    }

    const streamMatch = STREAM_PLAYLIST_PATTERN.exec(assetName);
    if (streamMatch) {
      const renditionIndex = Number(streamMatch[1]);
      assertRenditionIndex(mediaInfo, renditionIndex);
      return playlistResponse(
        createMediaPlaylist(session, renditionIndex),
        session.id,
        true,
        mediaInfo,
      );
    }

    const subtitlePlaylistMatch = SUBTITLE_PLAYLIST_PATTERN.exec(assetName);
    if (subtitlePlaylistMatch) {
      const subtitleIndex = Number(subtitlePlaylistMatch[1]);
      assertSubtitleIndex(mediaInfo, subtitleIndex);
      return playlistResponse(
        createSubtitlePlaylist(session, subtitleIndex),
        session.id,
        true,
        mediaInfo,
      );
    }

    const avMatch = AV_SEGMENT_PATTERN.exec(assetName);
    if (avMatch) {
      const renditionIndex = Number(avMatch[1]);
      const segmentIndex = Number(avMatch[2]);
      assertRenditionIndex(mediaInfo, renditionIndex);
      assertSegmentIndex(mediaInfo, segmentIndex);
      await ensureAvSegment(
        session,
        renditionIndex,
        segmentIndex,
        requestSignal,
      );
      return fileResponse(session, assetName, 'video/mp2t', MAX_SEGMENT_BYTES);
    }

    const subtitleMatch = SUBTITLE_SEGMENT_PATTERN.exec(assetName);
    if (subtitleMatch) {
      const subtitleIndex = Number(subtitleMatch[1]);
      const segmentIndex = Number(subtitleMatch[2]);
      assertSubtitleIndex(mediaInfo, subtitleIndex);
      assertSegmentIndex(mediaInfo, segmentIndex);
      await ensureSubtitleSegment(
        session,
        subtitleIndex,
        segmentIndex,
        requestSignal,
      );
      return fileResponse(
        session,
        assetName,
        'text/vtt; charset=utf-8',
        MAX_SUBTITLE_BYTES,
      );
    }

    throw new HttpError(400, 'Unsupported VOD asset');
  } catch (error) {
    return errorResponse(error, 'Failed to serve seekable VOD asset');
  }
}

function createMasterPlaylist(session: VodSession): string {
  const mediaInfo = requireMediaInfo(session);
  const audioLabels = getUniqueTrackLabels(mediaInfo.audioTracks, 'Audio');
  const subtitleLabels = getUniqueTrackLabels(
    mediaInfo.subtitleTracks,
    'Subtitle',
  );
  const defaultAudioIndex = getDefaultTrackIndex(mediaInfo.audioTracks);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  mediaInfo.audioTracks.forEach((track, index) => {
    lines.push(
      [
        '#EXT-X-MEDIA:TYPE=AUDIO',
        'GROUP-ID="audio"',
        `NAME="${audioLabels[index]}"`,
        `LANGUAGE="${getSafeLanguage(track.language)}"`,
        `DEFAULT=${index === defaultAudioIndex ? 'YES' : 'NO'}`,
        'AUTOSELECT=YES',
        'CHANNELS="2"',
        `URI="${getAssetUrl(session.id, `stream-${index + 1}.m3u8`)}"`,
      ].join(','),
    );
  });

  mediaInfo.subtitleTracks.forEach((track, index) => {
    lines.push(
      [
        '#EXT-X-MEDIA:TYPE=SUBTITLES',
        'GROUP-ID="subs"',
        `NAME="${subtitleLabels[index]}"`,
        `LANGUAGE="${getSafeLanguage(track.language)}"`,
        'DEFAULT=NO',
        'AUTOSELECT=YES',
        `FORCED=${track.isForced ? 'YES' : 'NO'}`,
        `URI="${getAssetUrl(session.id, `subtitle-${index}.m3u8`)}"`,
      ].join(','),
    );
  });

  const streamAttributes = ['BANDWIDTH=12000000'];
  if (mediaInfo.audioTracks.length > 0) streamAttributes.push('AUDIO="audio"');
  if (mediaInfo.subtitleTracks.length > 0) {
    streamAttributes.push('SUBTITLES="subs"');
  }
  streamAttributes.push('CLOSED-CAPTIONS=NONE');
  lines.push(
    `#EXT-X-STREAM-INF:${streamAttributes.join(',')}`,
    getAssetUrl(session.id, 'stream-0.m3u8'),
    '',
  );
  return lines.join('\n');
}

function createMediaPlaylist(
  session: VodSession,
  renditionIndex: number,
): string {
  const mediaInfo = requireMediaInfo(session);
  const lines = createVodPlaylistHeader();
  for (let segmentIndex = 0; segmentIndex < mediaInfo.segmentCount; segmentIndex += 1) {
    lines.push(
      '#EXT-X-DISCONTINUITY',
      `#EXTINF:${getSegmentDuration(mediaInfo, segmentIndex).toFixed(3)},`,
      getAssetUrl(
        session.id,
        `segment-${renditionIndex}-${formatSegmentIndex(segmentIndex)}.ts`,
      ),
    );
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

function createSubtitlePlaylist(
  session: VodSession,
  subtitleIndex: number,
): string {
  const mediaInfo = requireMediaInfo(session);
  const lines = createVodPlaylistHeader();
  for (let segmentIndex = 0; segmentIndex < mediaInfo.segmentCount; segmentIndex += 1) {
    lines.push(
      '#EXT-X-DISCONTINUITY',
      `#EXTINF:${getSegmentDuration(mediaInfo, segmentIndex).toFixed(3)},`,
      getAssetUrl(
        session.id,
        `subtitle-${subtitleIndex}-${formatSegmentIndex(segmentIndex)}.vtt`,
      ),
    );
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

function createVodPlaylistHeader(): string[] {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_DURATION_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-DISCONTINUITY-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
}

async function ensureAvSegment(
  session: VodSession,
  renditionIndex: number,
  segmentIndex: number,
  requestSignal: AbortSignal,
): Promise<void> {
  if (requestSignal.aborted) throw new HttpError(499, 'Client closed request');
  const assetName = `segment-${renditionIndex}-${formatSegmentIndex(segmentIndex)}.ts`;
  const assetPath = getSafeAssetPath(session, assetName);
  if (await isPublishedFile(assetPath, MAX_SEGMENT_BYTES)) return;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (session.closing) throw new HttpError(410, 'Playback session is closing');

    let job = findCoveringAvJob(session, segmentIndex);
    if (!job) {
      while (session.avJobs.size >= MAX_ACTIVE_AV_JOBS) {
        const activeJob = Array.from(session.avJobs.values())[0];
        activeJob.cancel?.(
          new HttpError(409, 'Seek window superseded by a newer request'),
        );
        await activeJob.promise.catch(() => undefined);
        if (await isPublishedFile(assetPath, MAX_SEGMENT_BYTES)) return;
        if (session.closing) {
          throw new HttpError(410, 'Playback session is closing');
        }
      }
      job = startAvJob(session, segmentIndex);
    }

    job.waiters += 1;
    let published: boolean;
    try {
      published = await waitForAvJobAsset(
        session,
        renditionIndex,
        segmentIndex,
        assetPath,
        job,
        ASSET_WAIT_TIMEOUT_MS,
        requestSignal,
      );
    } finally {
      job.waiters = Math.max(0, job.waiters - 1);
      if (requestSignal.aborted && job.waiters === 0) {
        job.cancel?.(new HttpError(499, 'Client closed seek request'));
      }
    }
    if (published) return;
    if (job.error) throw job.error;
  }

  throw new HttpError(502, `FFmpeg did not publish ${assetName}`);
}

function findCoveringAvJob(
  session: VodSession,
  segmentIndex: number,
): AvJob | null {
  for (const job of Array.from(session.avJobs.values())) {
    if (segmentIndex >= job.startIndex && segmentIndex < job.endIndex) {
      return job;
    }
  }
  return null;
}

function startAvJob(session: VodSession, startIndex: number): AvJob {
  const mediaInfo = requireMediaInfo(session);
  const defaultEndIndex = Math.min(
    mediaInfo.segmentCount,
    startIndex + AV_WINDOW_SEGMENTS,
  );
  // A backwards seek can start while a later window is still running. Keep
  // declared windows disjoint so all renditions for a sequence number come
  // from the same seek base. Each job also writes under a unique prefix below,
  // which contains FFmpeg's possible keyframe-preroll overflow safely.
  const nextActiveStart = Array.from(session.avJobs.values()).reduce(
    (nearest, activeJob) =>
      activeJob.startIndex > startIndex
        ? Math.min(nearest, activeJob.startIndex)
        : nearest,
    defaultEndIndex,
  );
  const endIndex = Math.max(
    startIndex + 1,
    Math.min(defaultEndIndex, nextActiveStart),
  );
  const job: AvJob = {
    startIndex,
    endIndex,
    outputPrefix: `av-${formatSegmentIndex(startIndex)}-${Date.now().toString(36)}`,
    cancel: null,
    waiters: 0,
    process: null,
    promise: Promise.resolve(),
    finished: false,
    error: null,
    stderr: '',
  };
  session.avJobs.set(startIndex, job);
  job.promise = runAvJob(session, job)
    .catch((error) => {
      job.error = toError(error);
      throw error;
    })
    .finally(async () => {
      await publishAvJobAssets(session, job).catch((error) => {
        if (!job.error) job.error = toError(error);
      });
      await removeAvJobArtifacts(session, job).catch(() => undefined);
      job.finished = true;
      if (session.avJobs.get(startIndex) === job) {
        session.avJobs.delete(startIndex);
      }
    });
  void job.promise.catch(() => undefined);
  return job;
}

async function runAvJob(session: VodSession, job: AvJob): Promise<void> {
  const mediaInfo = requireMediaInfo(session);
  const proxyUrl = requireProxyUrl(session);
  const startSeconds = job.startIndex * SEGMENT_DURATION_SECONDS;
  const windowDuration = Math.min(
    mediaInfo.duration - startSeconds,
    (job.endIndex - job.startIndex) * SEGMENT_DURATION_SECONDS,
  );
  if (!(windowDuration > 0)) {
    throw new HttpError(416, 'Requested segment is outside the media duration');
  }

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
        `expr:gte(t,n_forced*${SEGMENT_DURATION_SECONDS})`,
        '-sc_threshold',
        '0',
      ]
    : ['-c:v', 'copy'];
  const mapArgs = [
    '-map',
    '0:v:0',
    ...mediaInfo.audioTracks.flatMap((track) => [
      '-map',
      `0:a:${track.relativeIndex}`,
    ]),
  ];
  const hasAudio = mediaInfo.audioTracks.length > 0;
  const defaultAudioIndex = getDefaultTrackIndex(mediaInfo.audioTracks);
  const varStreamMap = [
    hasAudio ? 'v:0,agroup:audio' : 'v:0',
    ...mediaInfo.audioTracks.map((_track, index) => {
      const values = [
        `a:${index}`,
        'agroup:audio',
        `language:${getSafeLanguage(mediaInfo.audioTracks[index].language)}`,
      ];
      if (index === defaultAudioIndex) values.push('default:yes');
      return values.join(',');
    }),
  ].join(' ');

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-rw_timeout',
    '60000000',
    '-user_agent',
    USER_AGENT,
    ...(session.transcode ? [] : ['-noaccurate_seek']),
    '-ss',
    formatFfmpegTime(startSeconds),
    '-seekable',
    '1',
    '-multiple_requests',
    '1',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_on_network_error',
    '1',
    '-reconnect_on_http_error',
    '4xx,5xx',
    '-reconnect_delay_max',
    '2',
    '-i',
    proxyUrl,
    '-t',
    formatFfmpegTime(windowDuration),
    ...mapArgs,
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
    String(SEGMENT_DURATION_SECONDS),
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'vod',
    '-hls_segment_type',
    'mpegts',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_start_number_source',
    'generic',
    '-start_number',
    String(job.startIndex),
    '-hls_segment_filename',
    `${job.outputPrefix}-segment-%v-%06d.ts`,
    '-var_stream_map',
    varStreamMap,
    `${job.outputPrefix}-stream-%v.m3u8`,
  ];

  await runFfmpegJob(
    session,
    job,
    args,
    FFMPEG_AV_TIMEOUT_MS,
    'seek window',
  );
}

function getAvJobAssetPath(
  session: VodSession,
  job: AvJob,
  renditionIndex: number,
  segmentIndex: number,
): string {
  return getSafeTemporaryPath(
    session,
    `${job.outputPrefix}-segment-${renditionIndex}-${formatSegmentIndex(segmentIndex)}.ts`,
  );
}

async function publishAvJobAsset(
  sourcePath: string,
  assetPath: string,
): Promise<boolean> {
  if (await isPublishedFile(assetPath, MAX_SEGMENT_BYTES)) {
    await rm(sourcePath, { force: true }).catch(() => undefined);
    return true;
  }
  if (!(await isPublishedFile(sourcePath, MAX_SEGMENT_BYTES))) return false;

  try {
    await rename(sourcePath, assetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      (code === 'ENOENT' ||
        code === 'EEXIST' ||
        code === 'EPERM' ||
        code === 'EACCES') &&
      (await isPublishedFile(assetPath, MAX_SEGMENT_BYTES))
    ) {
      await rm(sourcePath, { force: true }).catch(() => undefined);
      return true;
    }
    throw error;
  }
  return isPublishedFile(assetPath, MAX_SEGMENT_BYTES);
}

async function publishAvJobAssets(
  session: VodSession,
  job: AvJob,
): Promise<void> {
  const mediaInfo = requireMediaInfo(session);
  for (let segmentIndex = job.startIndex; segmentIndex < job.endIndex; segmentIndex += 1) {
    for (
      let renditionIndex = 0;
      renditionIndex <= mediaInfo.audioTracks.length;
      renditionIndex += 1
    ) {
      const sourcePath = getAvJobAssetPath(
        session,
        job,
        renditionIndex,
        segmentIndex,
      );
      const assetPath = getSafeAssetPath(
        session,
        `segment-${renditionIndex}-${formatSegmentIndex(segmentIndex)}.ts`,
      );
      await publishAvJobAsset(sourcePath, assetPath);
    }
  }
}

async function removeAvJobArtifacts(
  session: VodSession,
  job: AvJob,
): Promise<void> {
  const prefix = `${job.outputPrefix}-`;
  const names = await readdir(session.directory);
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix))
      .map((name) => rm(getSafeTemporaryPath(session, name), { force: true })),
  );
}

async function waitForAvJobAsset(
  session: VodSession,
  renditionIndex: number,
  segmentIndex: number,
  assetPath: string,
  job: AvJob,
  timeoutMs: number,
  requestSignal: AbortSignal,
): Promise<boolean> {
  const sourcePath = getAvJobAssetPath(
    session,
    job,
    renditionIndex,
    segmentIndex,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (requestSignal.aborted) {
      throw new HttpError(499, 'Client closed seek request');
    }
    if (await isPublishedFile(assetPath, MAX_SEGMENT_BYTES)) return true;
    if (await publishAvJobAsset(sourcePath, assetPath)) return true;
    if (job.finished) return false;
    await delay(100);
  }
  if (await isPublishedFile(assetPath, MAX_SEGMENT_BYTES)) return true;
  if (await publishAvJobAsset(sourcePath, assetPath)) return true;
  throw new HttpError(504, 'Timed out waiting for FFmpeg to publish the segment');
}

async function ensureSubtitleSegment(
  session: VodSession,
  subtitleIndex: number,
  segmentIndex: number,
  requestSignal: AbortSignal,
): Promise<void> {
  if (requestSignal.aborted) throw new HttpError(499, 'Client closed request');
  const assetName = `subtitle-${subtitleIndex}-${formatSegmentIndex(segmentIndex)}.vtt`;
  const assetPath = getSafeAssetPath(session, assetName);
  if (await isPublishedFile(assetPath, MAX_SUBTITLE_BYTES)) return;

  const key = `${subtitleIndex}:${segmentIndex}`;
  let job = session.subtitleJobs.get(key);
  if (!job) {
    while (session.subtitleJobs.size >= MAX_ACTIVE_SUBTITLE_JOBS) {
      const activeJob = Array.from(session.subtitleJobs.values())[0];
      activeJob.cancel?.(
        new HttpError(409, 'Subtitle seek superseded by a newer request'),
      );
      await activeJob.promise.catch(() => undefined);
      if (await isPublishedFile(assetPath, MAX_SUBTITLE_BYTES)) return;
    }
    job = startSubtitleJob(session, subtitleIndex, segmentIndex, key);
  }

  job.waiters += 1;
  let published: boolean;
  try {
    published = await waitForJobAsset(
      assetPath,
      MAX_SUBTITLE_BYTES,
      job,
      ASSET_WAIT_TIMEOUT_MS,
      requestSignal,
    );
  } finally {
    job.waiters = Math.max(0, job.waiters - 1);
    if (requestSignal.aborted && job.waiters === 0) {
      job.cancel?.(new HttpError(499, 'Client closed subtitle request'));
    }
  }
  if (published) return;
  if (job.error) throw job.error;
  throw new HttpError(502, `FFmpeg did not publish ${assetName}`);
}

function startSubtitleJob(
  session: VodSession,
  subtitleIndex: number,
  segmentIndex: number,
  key: string,
): SubtitleJob {
  const job: SubtitleJob = {
    key,
    cancel: null,
    waiters: 0,
    process: null,
    promise: Promise.resolve(),
    finished: false,
    error: null,
    stderr: '',
  };
  session.subtitleJobs.set(key, job);
  job.promise = runSubtitleJob(session, job, subtitleIndex, segmentIndex)
    .catch((error) => {
      job.error = toError(error);
      throw error;
    })
    .finally(() => {
      job.finished = true;
      if (session.subtitleJobs.get(key) === job) {
        session.subtitleJobs.delete(key);
      }
    });
  void job.promise.catch(() => undefined);
  return job;
}

async function runSubtitleJob(
  session: VodSession,
  job: SubtitleJob,
  subtitleIndex: number,
  segmentIndex: number,
): Promise<void> {
  const mediaInfo = requireMediaInfo(session);
  const proxyUrl = requireProxyUrl(session);
  const track = mediaInfo.subtitleTracks[subtitleIndex];
  if (!track) throw new HttpError(404, 'Subtitle track not found');

  const assetName = `subtitle-${subtitleIndex}-${formatSegmentIndex(segmentIndex)}.vtt`;
  const assetPath = getSafeAssetPath(session, assetName);
  const tempName = `${assetName}.${process.pid}.${Date.now()}.tmp.vtt`;
  const tempPath = getSafeTemporaryPath(session, tempName);
  const startSeconds = segmentIndex * SEGMENT_DURATION_SECONDS;
  const segmentDuration = getSegmentDuration(mediaInfo, segmentIndex);

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-rw_timeout',
    '60000000',
    '-user_agent',
    USER_AGENT,
    ...(session.transcode ? [] : ['-noaccurate_seek']),
    '-ss',
    formatFfmpegTime(startSeconds),
    '-seekable',
    '1',
    '-multiple_requests',
    '1',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_on_network_error',
    '1',
    '-reconnect_on_http_error',
    '4xx,5xx',
    '-reconnect_delay_max',
    '2',
    '-i',
    proxyUrl,
    '-t',
    formatFfmpegTime(segmentDuration),
    '-map',
    `0:s:${track.relativeIndex}`,
    '-vn',
    '-an',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:s',
    'webvtt',
    '-f',
    'webvtt',
    tempPath,
    // Matroska files are commonly indexed only by video cues. Keeping video
    // selected into a null sink lets a far subtitle seek use that cue index
    // instead of scanning from byte zero and timing out.
    '-t',
    formatFfmpegTime(segmentDuration),
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-c:v',
    'copy',
    '-f',
    'null',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
  ];

  try {
    await runFfmpegJob(
      session,
      job,
      args,
      FFMPEG_SUBTITLE_TIMEOUT_MS,
      'subtitle segment',
    );

    let data: Buffer;
    try {
      data = await readFile(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      data = Buffer.alloc(0);
    }
    if (data.length > MAX_SUBTITLE_BYTES) {
      throw new HttpError(502, 'Generated subtitle segment exceeds the size limit');
    }
    if (data.length === 0) {
      await writeFile(tempPath, 'WEBVTT\n\n', { encoding: 'utf8', flag: 'w' });
    } else if (!data.toString('utf8', 0, Math.min(data.length, 32)).startsWith('WEBVTT')) {
      throw new HttpError(502, 'FFmpeg generated an invalid WebVTT segment');
    }

    try {
      await rename(tempPath, assetPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      if (!(await isPublishedFile(assetPath, MAX_SUBTITLE_BYTES))) throw error;
      await rm(tempPath, { force: true });
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function runFfmpegJob(
  session: VodSession,
  job: AvJob | SubtitleJob,
  args: string[],
  timeoutMs: number,
  description: string,
): Promise<void> {
  if (session.closing || session.abortController.signal.aborted) {
    return Promise.reject(createAbortError('Playback session is closing'));
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      cwd: session.directory,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    job.process = child;
    let settled = false;
    let terminationError: Error | null = null;
    let terminationRetry: NodeJS.Timeout | null = null;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (terminationRetry) clearTimeout(terminationRetry);
      job.cancel = null;
      session.abortController.signal.removeEventListener('abort', handleAbort);
    };
    const settleError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const requestTermination = (error: Error) => {
      if (settled || terminationError) return;
      terminationError = error;
      if (timeout) clearTimeout(timeout);
      terminateProcessTree(child, 'SIGTERM');
      // Keep ownership of the process and the job-map slot until Node reports
      // that every stdio handle has closed. Retry termination if needed, but
      // never let a still-running FFmpeg write into a replacement session.
      terminationRetry = setTimeout(() => {
        terminateProcessTree(child, 'SIGKILL');
      }, 10_000);
      terminationRetry.unref();
    };
    const handleAbort = () => {
      requestTermination(createAbortError('Playback session is closing'));
    };
    timeout = setTimeout(() => {
      requestTermination(
        new HttpError(504, `FFmpeg ${description} exceeded its timeout`),
      );
    }, timeoutMs);
    timeout.unref();
    job.cancel = requestTermination;
    session.abortController.signal.addEventListener('abort', handleAbort, {
      once: true,
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      job.stderr = `${job.stderr}${chunk.toString()}`.slice(-16 * 1024);
    });
    child.once('error', (error) => {
      job.process = null;
      settleError(new HttpError(500, `Unable to launch FFmpeg: ${error.message}`));
    });
    child.once('close', (code, closeSignal) => {
      job.process = null;
      if (settled) return;
      settled = true;
      cleanup();
      if (terminationError) {
        reject(terminationError);
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new HttpError(
          502,
          getJobDiagnostic(job) ||
            `FFmpeg ${description} exited with code ${String(code)} and signal ${String(closeSignal)}`,
        ),
      );
    });
  });
}

async function waitForJobAsset(
  assetPath: string,
  maxBytes: number,
  job: AvJob | SubtitleJob,
  timeoutMs: number,
  requestSignal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (requestSignal?.aborted) {
      throw new HttpError(499, 'Client closed media request');
    }
    if (await isPublishedFile(assetPath, maxBytes)) return true;
    if (job.finished) return false;
    await delay(100);
  }
  if (await isPublishedFile(assetPath, maxBytes)) return true;
  throw new HttpError(504, 'Timed out waiting for FFmpeg to publish the segment');
}

async function isPublishedFile(
  assetPath: string,
  maxBytes: number,
): Promise<boolean> {
  try {
    const details = await stat(assetPath);
    if (!details.isFile() || details.size <= 0) return false;
    if (details.size > maxBytes) {
      throw new HttpError(502, 'Generated media asset exceeds the size limit');
    }
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EBUSY') return false;
    throw error;
  }
}

async function fileResponse(
  session: VodSession,
  assetName: string,
  contentType: string,
  maxBytes: number,
): Promise<NextResponse> {
  const assetPath = getSafeAssetPath(session, assetName);
  const details = await stat(assetPath);
  if (!details.isFile() || details.size <= 0 || details.size > maxBytes) {
    throw new HttpError(502, 'Generated media asset failed validation');
  }
  const data = await readFile(assetPath);
  if (data.length !== details.size || data.length > maxBytes) {
    throw new HttpError(502, 'Generated media asset changed while being read');
  }
  session.lastAccess = Date.now();
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(data.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'X-HLS-Session': session.id,
    },
  });
}

function playlistResponse(
  manifest: string,
  sessionId: string,
  immutable: boolean,
  mediaInfo: MediaInfo | null,
): NextResponse {
  return new NextResponse(manifest, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': String(Buffer.byteLength(manifest)),
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'X-HLS-Session': sessionId,
      ...(mediaInfo
        ? {
            'X-VOD-Duration': mediaInfo.duration.toFixed(3),
            'X-VOD-Segments': String(mediaInfo.segmentCount),
          }
        : {}),
    },
  });
}

function assertRenditionIndex(
  mediaInfo: MediaInfo,
  renditionIndex: number,
): void {
  if (
    !Number.isSafeInteger(renditionIndex) ||
    renditionIndex < 0 ||
    renditionIndex > mediaInfo.audioTracks.length
  ) {
    throw new HttpError(404, 'Media rendition not found');
  }
}

function assertSubtitleIndex(mediaInfo: MediaInfo, subtitleIndex: number): void {
  if (
    !Number.isSafeInteger(subtitleIndex) ||
    subtitleIndex < 0 ||
    subtitleIndex >= mediaInfo.subtitleTracks.length
  ) {
    throw new HttpError(404, 'Subtitle rendition not found');
  }
}

function assertSegmentIndex(mediaInfo: MediaInfo, segmentIndex: number): void {
  if (
    !Number.isSafeInteger(segmentIndex) ||
    segmentIndex < 0 ||
    segmentIndex >= mediaInfo.segmentCount
  ) {
    throw new HttpError(416, 'Requested segment is outside the media duration');
  }
}

function requireMediaInfo(session: VodSession): MediaInfo {
  if (!session.mediaInfo) {
    throw new HttpError(503, 'Playback session is still initializing');
  }
  return session.mediaInfo;
}

function requireProxyUrl(session: VodSession): string {
  if (!session.proxyUrl) {
    throw new HttpError(503, 'Seekable source transport is unavailable');
  }
  return session.proxyUrl;
}

function getSegmentDuration(mediaInfo: MediaInfo, segmentIndex: number): number {
  assertSegmentIndex(mediaInfo, segmentIndex);
  return Math.min(
    SEGMENT_DURATION_SECONDS,
    mediaInfo.duration - segmentIndex * SEGMENT_DURATION_SECONDS,
  );
}

function formatSegmentIndex(segmentIndex: number): string {
  return String(segmentIndex).padStart(6, '0');
}

function formatFfmpegTime(seconds: number): string {
  return Math.max(0, seconds).toFixed(3);
}

function getAssetUrl(sessionId: string, assetName: string): string {
  return `?session=${encodeURIComponent(sessionId)}&asset=${encodeURIComponent(assetName)}`;
}

function getTagValue(
  tags: Record<string, unknown> | undefined,
  wantedName: string,
): string | null {
  if (!tags) return null;
  for (const [name, value] of Object.entries(tags)) {
    if (name.toLowerCase() === wantedName && typeof value === 'string') {
      const safeValue = sanitizeMetadataValue(value);
      return safeValue || null;
    }
  }
  return null;
}

function isEnabledDisposition(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function getSafeLanguage(language: string | null): string {
  if (!language) return 'und';
  const normalized = language.trim().toLowerCase().replace(/_/g, '-');
  return /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/.test(normalized)
    ? normalized.slice(0, 35)
    : 'und';
}

function sanitizeMetadataValue(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f"\\,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getUniqueTrackLabels(
  tracks: MediaTrack[],
  fallbackPrefix: string,
): string[] {
  const occurrences = new Map<string, number>();
  return tracks.map((track, index) => {
    const title = sanitizeMetadataValue(track.title || '');
    const languageLabel = getLanguageDisplayName(track.language);
    const titleMatchesLanguage = Boolean(
      title &&
        languageLabel &&
        title.localeCompare(languageLabel, 'en', { sensitivity: 'base' }) === 0,
    );
    const baseLabel =
      title && languageLabel && !titleMatchesLanguage
        ? sanitizeMetadataValue(`${languageLabel} — ${title}`)
        : title || languageLabel || `${fallbackPrefix} ${index + 1}`;
    const count = (occurrences.get(baseLabel) ?? 0) + 1;
    occurrences.set(baseLabel, count);
    return sanitizeMetadataValue(
      count === 1 ? baseLabel : `${baseLabel} ${count}`,
    );
  });
}

function getDefaultTrackIndex(tracks: MediaTrack[]): number {
  const explicitDefault = tracks.findIndex((track) => track.isDefault);
  return explicitDefault >= 0 ? explicitDefault : tracks.length > 0 ? 0 : -1;
}

function getLanguageDisplayName(language: string | null): string | null {
  const normalized = getSafeLanguage(language);
  if (normalized === 'und') return null;
  const iso3ToIso2: Record<string, string> = {
    ara: 'ar',
    chi: 'zh',
    deu: 'de',
    eng: 'en',
    fre: 'fr',
    fra: 'fr',
    ger: 'de',
    hin: 'hi',
    ita: 'it',
    jpn: 'ja',
    kor: 'ko',
    por: 'pt',
    rus: 'ru',
    spa: 'es',
    zho: 'zh',
  };
  const displayCode = iso3ToIso2[normalized] ?? normalized;
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language' }).of(displayCode) ??
      normalized.toUpperCase()
    );
  } catch {
    return normalized.toUpperCase();
  }
}

function getSessionDirectory(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Unsafe VOD session identifier');
  }
  return path.resolve(CACHE_ROOT, sessionId);
}

function assertSafeSessionDirectory(directory: string, sessionId: string): void {
  const expected = getSessionDirectory(sessionId);
  if (directory !== expected || path.dirname(directory) !== CACHE_ROOT) {
    throw new Error('Unsafe VOD cache directory');
  }
}

function getSafeAssetPath(session: VodSession, assetName: string): string {
  if (!ASSET_NAME_PATTERN.test(assetName)) {
    throw new HttpError(400, 'Invalid VOD asset name');
  }
  const assetPath = path.resolve(session.directory, assetName);
  if (path.dirname(assetPath) !== session.directory) {
    throw new HttpError(400, 'Invalid VOD asset path');
  }
  return assetPath;
}

function getSafeTemporaryPath(session: VodSession, tempName: string): string {
  if (!/^[a-z0-9.-]{1,160}$/i.test(tempName) || tempName.includes('..')) {
    throw new Error('Unsafe temporary asset name');
  }
  const tempPath = path.resolve(session.directory, tempName);
  if (path.dirname(tempPath) !== session.directory) {
    throw new Error('Unsafe temporary asset path');
  }
  return tempPath;
}

async function removeIdleSessions(): Promise<void> {
  const now = Date.now();
  const expired = Array.from(sessionStore.sessions.values()).filter(
    (session) => !session.closing && now - session.lastAccess > SESSION_IDLE_MS,
  );
  await Promise.all(
    expired.map((session) =>
      cleanupSession(session).catch((error) => {
        console.error(`Failed to clean VOD session ${session.id}:`, error);
      }),
    ),
  );
}

function cleanupSession(session: VodSession): Promise<void> {
  if (session.cleanupPromise) return session.cleanupPromise;
  session.closing = true;
  session.abortController.abort();
  session.cleanupPromise = (async () => {
    await session.initializePromise.catch(() => undefined);

    const jobs = [
      ...Array.from(session.avJobs.values()),
      ...Array.from(session.subtitleJobs.values()),
    ];
    jobs.forEach((job) => {
      if (job.process) terminateProcessTree(job.process, 'SIGTERM');
    });
    await Promise.allSettled(jobs.map((job) => job.promise));
    unregisterParallelRangeSource(session.id);
    session.proxyUrl = null;
    session.sourceLength = null;

    try {
      assertSafeSessionDirectory(session.directory, session.id);
      await rm(session.directory, { recursive: true, force: true });
    } finally {
      if (sessionStore.sessions.get(session.id) === session) {
        sessionStore.sessions.delete(session.id);
      }
    }
  })();
  return session.cleanupPromise;
}

function terminateProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  const terminateChild = () => {
    try {
      child.kill(signal);
    } catch {
      // The process can exit between the state check and kill call.
    }
  };

  if (process.platform !== 'win32' || !child.pid) {
    terminateChild();
    return;
  }
  try {
    const taskkill = spawn(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    taskkill.once('error', terminateChild);
    taskkill.unref();
  } catch {
    terminateChild();
  }
}

function createTimedSignal(
  parentSignal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const handleAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    handleAbort();
  } else {
    parentSignal.addEventListener('abort', handleAbort, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`Operation exceeded ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', handleAbort);
    },
  };
}

function getJobDiagnostic(job: AvJob | SubtitleJob): string {
  return job.stderr
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-8)
    .join('\n')
    .slice(-4000);
}

function errorResponse(error: unknown, fallback: string): NextResponse {
  const status = error instanceof HttpError ? error.status : 500;
  const details = formatError(error);
  if (status >= 500) console.error(`${fallback}:`, error);
  return NextResponse.json(
    { error: status >= 500 ? fallback : details, ...(status >= 500 ? { details } : {}) },
    { status },
  );
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
