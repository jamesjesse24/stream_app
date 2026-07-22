import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, readFile, rm, stat } from 'fs/promises';
import path from 'path';
import type { Writable } from 'stream';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_ROOT = path.resolve(process.cwd(), '.hls-cache');
const SESSION_IDLE_MS = 2 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;
const STARTUP_TIMEOUT_MS = 30 * 1000;
const RANGE_CHUNK_BYTES = 2 * 1024 * 1024;
const RANGE_CONCURRENCY = 8;
const MAX_TRACKS_PER_TYPE = 9;
const FFPROBE_TIMEOUT_MS = 20 * 1000;
const FFPROBE_MAX_OUTPUT_BYTES = 1024 * 1024;
const HLS_PIPELINE_VERSION = 'fmp4-multitrack-v2';
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/;
const MASTER_PLAYLIST_NAME = 'master.m3u8';
const AV_PLAYLIST_NAME_PATTERN = /^stream-([0-9])\.m3u8$/;
const AV_INIT_NAME_PATTERN = /^init-([0-9])\.mp4$/;
const AV_SEGMENT_NAME_PATTERN = /^segment-([0-9])-(\d{6})\.m4s$/;
const SUBTITLE_PLAYLIST_NAME_PATTERN = /^subtitle-([0-8])\.m3u8$/;
const SUBTITLE_SEGMENT_NAME_PATTERN = /^subtitle-([0-8])-(\d{6})\.vtt$/;
const HLS_ASSET_NAME_PATTERN = /^(?:master\.m3u8|stream-[0-9]\.m3u8|init-[0-9]\.mp4|segment-[0-9]-\d{6}\.m4s|subtitle-[0-8]\.m3u8|subtitle-[0-8]-\d{6}\.vtt)$/;
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

interface HlsSession {
  id: string;
  key: string;
  sourceUrl: string;
  transcode: boolean;
  directory: string;
  playlistPath: string;
  mediaInfo: MediaInfo;
  ffmpeg: ChildProcess | null;
  inputAbortController: AbortController | null;
  inputPumpPromise: Promise<void> | null;
  startPromise: Promise<void>;
  stderr: string;
  startupError: string | null;
  exitCode: number | null;
  hasProducedManifest: boolean;
  lastAccess: number;
  closing: boolean;
  cleanupPromise?: Promise<void>;
}

interface MediaTrack {
  relativeIndex: number;
  codecName: string | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
}

interface MediaInfo {
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
  probeWarning: string | null;
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  tags?: Record<string, unknown>;
  disposition?: Record<string, unknown>;
}

interface FfprobeResult {
  streams?: FfprobeStream[];
}

interface RangeSource {
  contentLength: number;
}

type RangeChunkResult =
  | { ok: true; chunk: Uint8Array }
  | { ok: false; error: unknown };

interface HlsSessionStore {
  sessions: Map<string, HlsSession>;
  cleanupTimer?: NodeJS.Timeout;
}

const globalWithHlsSessions = globalThis as typeof globalThis & {
  __uhdHlsSessionStore?: HlsSessionStore;
};

const sessionStore =
  globalWithHlsSessions.__uhdHlsSessionStore ??
  (globalWithHlsSessions.__uhdHlsSessionStore = {
    sessions: new Map<string, HlsSession>(),
  });

if (!sessionStore.cleanupTimer) {
  sessionStore.cleanupTimer = setInterval(() => {
    void removeIdleSessions();
  }, CLEANUP_INTERVAL_MS);
  sessionStore.cleanupTimer.unref();
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session');
  const assetName = request.nextUrl.searchParams.get('asset');

  if (sessionId !== null || assetName !== null) {
    return serveAsset(sessionId, assetName);
  }

  const sourceValue = request.nextUrl.searchParams.get('url');
  if (!sourceValue) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 },
    );
  }

  const transcodeValue = request.nextUrl.searchParams.get('transcode');
  if (transcodeValue !== null && !['0', '1'].includes(transcodeValue)) {
    return NextResponse.json(
      { error: 'transcode must be either 0 or 1' },
      { status: 400 },
    );
  }

  let sourceUrl: string;
  try {
    sourceUrl = validateSourceUrl(sourceValue);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid source URL' },
      { status: 400 },
    );
  }

  try {
    const session = await getOrCreateSession(sourceUrl, transcodeValue === '1');
    session.lastAccess = Date.now();
    await session.startPromise;

    const result = await waitForManifest(session, STARTUP_TIMEOUT_MS);
    if (result.manifest) {
      session.lastAccess = Date.now();
      return new NextResponse(rewriteMasterManifest(result.manifest, session), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
          'X-HLS-Session': session.id,
        },
      });
    }

    if (result.error) {
      return NextResponse.json(
        {
          error: 'FFmpeg could not start the HLS session',
          details: result.error,
          session: session.id,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        error: 'Timed out waiting for the first HLS segment',
        details: getFfmpegDiagnostic(session) || undefined,
        session: session.id,
      },
      { status: 504 },
    );
  } catch (error) {
    console.error('HLS playback session error:', error);
    return NextResponse.json(
      {
        error: 'Failed to create HLS playback session',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

function validateSourceUrl(value: string): string {
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    throw new Error('url must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(source.protocol)) {
    throw new Error('Only http and https source URLs are supported');
  }

  if (source.username || source.password) {
    throw new Error('Source URLs containing credentials are not supported');
  }

  return source.toString();
}

async function getOrCreateSession(
  sourceUrl: string,
  transcode: boolean,
): Promise<HlsSession> {
  const key = `${HLS_PIPELINE_VERSION}\0${transcode ? 'transcode' : 'copy'}\0${sourceUrl}`;
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32);

  while (true) {
    const existing = sessionStore.sessions.get(id);
    if (existing) {
      if (existing.key !== key) {
        throw new Error('HLS session identifier collision');
      }

      if (existing.closing) {
        await existing.cleanupPromise;
        continue;
      }

      await existing.startPromise;
      if (existing.startupError && !existing.hasProducedManifest) {
        await cleanupSession(existing);
        continue;
      }

      existing.lastAccess = Date.now();
      return existing;
    }

    const directory = getSessionDirectory(id);
    const session: HlsSession = {
      id,
      key,
      sourceUrl,
      transcode,
      directory,
      playlistPath: path.join(directory, MASTER_PLAYLIST_NAME),
      mediaInfo: getFallbackMediaInfo(),
      ffmpeg: null,
      inputAbortController: null,
      inputPumpPromise: null,
      startPromise: Promise.resolve(),
      stderr: '',
      startupError: null,
      exitCode: null,
      hasProducedManifest: false,
      lastAccess: Date.now(),
      closing: false,
    };

    // Store the record before the first await so concurrent requests reuse the
    // same producer instead of spawning duplicate FFmpeg processes.
    sessionStore.sessions.set(id, session);
    session.startPromise = initializeSession(session).catch((error) => {
      session.startupError =
        error instanceof Error ? error.message : String(error);
    });

    return session;
  }
}

async function initializeSession(session: HlsSession): Promise<void> {
  const inputAbortController = new AbortController();
  session.inputAbortController = inputAbortController;

  assertSafeSessionDirectory(session.directory, session.id);

  // A cache directory can survive an ungraceful previous server exit. A new
  // in-memory session must never publish those stale playlist entries.
  await rm(session.directory, { recursive: true, force: true });
  await mkdir(session.directory, { recursive: true });

  const [rangeSource, mediaInfo] = await Promise.all([
    probeRangeSource(session.sourceUrl, inputAbortController.signal),
    probeMediaInfo(session.sourceUrl, inputAbortController.signal),
  ]);
  session.mediaInfo = mediaInfo;
  if (mediaInfo.probeWarning) {
    appendSessionDiagnostic(session, mediaInfo.probeWarning);
  }

  if (inputAbortController.signal.aborted || session.closing) {
    throw createAbortError('HLS session closed during source probing');
  }

  if (!rangeSource) {
    // This controller is exclusively for the range pump. Direct URL input is
    // owned by FFmpeg and is stopped by terminating the child process.
    inputAbortController.abort();
    session.inputAbortController = null;
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
        'expr:gte(t,n_forced*4)',
        '-sc_threshold',
        '0',
      ]
    : ['-c:v', 'copy'];

  const inputArgs = rangeSource
    ? ['-fflags', '+genpts', '-i', 'pipe:0']
    : [
        '-user_agent',
        USER_AGENT,
        '-fflags',
        '+genpts',
        '-i',
        session.sourceUrl,
      ];

  const avMapArgs = [
    '-map',
    '0:v:0',
    ...session.mediaInfo.audioTracks.flatMap((track) => [
      '-map',
      `0:a:${track.relativeIndex}`,
    ]),
  ];
  const audioMetadataArgs = session.mediaInfo.audioTracks.flatMap(
    (track, outputIndex) => getOutputTrackMetadataArgs('a', outputIndex, track),
  );
  const hasAudio = session.mediaInfo.audioTracks.length > 0;
  const audioDefaultIndex = getDefaultTrackIndex(session.mediaInfo.audioTracks);
  const varStreamMap = [
    hasAudio ? 'v:0,agroup:audio' : 'v:0',
    ...session.mediaInfo.audioTracks.map((track, outputIndex) => {
      const fields = [
        `a:${outputIndex}`,
        'agroup:audio',
        `language:${getSafeLanguage(track.language)}`,
      ];
      // HLS permits only one DEFAULT=YES rendition in an audio group. Some
      // Matroska files mark several tracks as default, so normalize that here.
      if (outputIndex === audioDefaultIndex) fields.push('default:yes');
      return fields.join(',');
    }),
  ].join(' ');
  const subtitleOutputArgs = session.mediaInfo.subtitleTracks.flatMap(
    (track, outputIndex) => [
      '-map',
      `0:s:${track.relativeIndex}`,
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-c:s',
      'webvtt',
      ...getOutputTrackMetadataArgs('s', 0, track),
      '-f',
      'segment',
      '-segment_time',
      '4',
      '-segment_list_type',
      'm3u8',
      '-segment_list_flags',
      '+live',
      '-segment_list_size',
      '0',
      '-write_empty_segments',
      '1',
      '-reset_timestamps',
      '0',
      '-segment_format',
      'webvtt',
      '-segment_list',
      `subtitle-${outputIndex}.m3u8`,
      `subtitle-${outputIndex}-%06d.vtt`,
    ],
  );

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...inputArgs,
      ...avMapArgs,
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      ...videoArgs,
      ...audioMetadataArgs,
      '-c:a',
      'aac',
      // E-AC-3 sources commonly expose 5.1(side). FFmpeg encodes that AAC
      // layout with channel_configuration=0 plus a Program Config Element,
      // which Chromium's MSE AAC path rejects with SourceBuffer append errors.
      // Stereo uses the universally supported AAC-LC channel configuration 2.
      '-ac',
      '2',
      '-b:a',
      '128k',
      '-max_muxing_queue_size',
      '2048',
      '-f',
      'hls',
      '-hls_time',
      '4',
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'event',
      '-hls_segment_type',
      'fmp4',
      '-hls_fmp4_init_filename',
      'init-%v.mp4',
      '-hls_flags',
      'independent_segments+temp_file',
      '-hls_segment_filename',
      'segment-%v-%06d.m4s',
      '-var_stream_map',
      varStreamMap,
      '-master_pl_name',
      MASTER_PLAYLIST_NAME,
      '-master_pl_publish_rate',
      '1',
      'stream-%v.m3u8',
      ...subtitleOutputArgs,
    ],
    {
      cwd: session.directory,
      windowsHide: true,
      stdio: [rangeSource ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    },
  );

  session.ffmpeg = ffmpeg;
  const ffmpegStdout = ffmpeg.stdout;
  const ffmpegStderr = ffmpeg.stderr;
  if (!ffmpegStdout || !ffmpegStderr) {
    inputAbortController.abort();
    terminateProcessTree(ffmpeg, 'SIGTERM');
    throw new Error('FFmpeg output pipes were not created');
  }

  ffmpegStderr.on('data', (chunk: Buffer) => {
    // Keep a bounded diagnostic tail so startup errors are useful without
    // retaining an entire movie's FFmpeg log in memory.
    session.stderr = `${session.stderr}${chunk.toString()}`.slice(-16 * 1024);
  });

  // stdout is unused by the HLS muxer, but draining it avoids any chance of a
  // child process blocking if FFmpeg writes an unexpected diagnostic there.
  ffmpegStdout.resume();

  ffmpeg.once('error', (error) => {
    inputAbortController.abort();
    if (!session.hasProducedManifest) {
      session.startupError = `Unable to launch FFmpeg: ${error.message}`;
    }
  });

  ffmpeg.once('close', (code, signal) => {
    inputAbortController.abort();
    session.ffmpeg = null;
    session.exitCode = code;

    if (code !== 0 && !session.hasProducedManifest) {
      session.startupError =
        getFfmpegDiagnostic(session) ||
        `FFmpeg exited before producing HLS output (code ${String(code)}, signal ${String(signal)})`;
    }
  });

  if (rangeSource) {
    const ffmpegStdin = ffmpeg.stdin;
    if (!ffmpegStdin) {
      throw new Error('FFmpeg range input pipe was not created');
    }

    // Attach a permanent listener before starting asynchronous writes. Child
    // stdin can emit EPIPE while a range fetch is settling after FFmpeg exits;
    // without a listener Node treats that expected teardown as uncaught.
    ffmpegStdin.on('error', (error: NodeJS.ErrnoException) => {
      if (
        !inputAbortController.signal.aborted &&
        !session.closing &&
        !['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes(error.code || '')
      ) {
        appendSessionDiagnostic(
          session,
          `FFmpeg input pipe failed: ${error.message}`,
        );
      }
      inputAbortController.abort();
    });

    session.inputPumpPromise = pumpOrderedRanges(
      session.sourceUrl,
      rangeSource.contentLength,
      ffmpegStdin,
      inputAbortController,
    ).catch((error) => {
      if (
        inputAbortController.signal.aborted ||
        session.closing ||
        ffmpeg.exitCode !== null
      ) {
        return;
      }

      const message = `Parallel range input failed: ${formatError(error)}`;
      appendSessionDiagnostic(session, message);
      session.startupError = message;
      inputAbortController.abort();

      if (!ffmpegStdin.destroyed) {
        ffmpegStdin.destroy();
      }
      terminateProcessTree(ffmpeg, 'SIGTERM');
    });
  }
}

async function probeRangeSource(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<RangeSource | null> {
  try {
    const response = await fetch(sourceUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'identity',
      },
      signal,
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const contentLength = Number(response.headers.get('content-length'));
    const acceptsRanges = response.headers
      .get('accept-ranges')
      ?.split(',')
      .some((value) => value.trim().toLowerCase() === 'bytes');

    if (
      !acceptsRanges ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0
    ) {
      return null;
    }

    return { contentLength };
  } catch (error) {
    if (signal.aborted) throw error;

    // Some otherwise playable origins reject or do not implement HEAD. Let
    // FFmpeg retain its existing direct-URL behavior for those sources.
    return null;
  }
}

function getFallbackMediaInfo(): MediaInfo {
  return {
    // Preserve the previous route's behavior if ffprobe is unavailable or the
    // origin refuses the independent metadata request. Movie sources normally
    // contain at least one audio stream, and the startup diagnostic will make
    // the fallback visible if that assumption is wrong.
    audioTracks: [
      {
        relativeIndex: 0,
        codecName: null,
        language: null,
        title: null,
        isDefault: true,
        isForced: false,
      },
    ],
    subtitleTracks: [],
    probeWarning: null,
  };
}

async function probeMediaInfo(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<MediaInfo> {
  try {
    const result = await runFfprobe(sourceUrl, signal);
    const audioTracks: MediaTrack[] = [];
    const subtitleTracks: MediaTrack[] = [];
    let audioIndex = 0;
    let subtitleIndex = 0;
    let omittedAudioTracks = 0;
    let omittedSubtitleTracks = 0;

    for (const stream of result.streams ?? []) {
      if (stream.codec_type === 'audio') {
        const track = createMediaTrack(stream, audioIndex);
        audioIndex += 1;
        if (audioTracks.length < MAX_TRACKS_PER_TYPE) {
          audioTracks.push(track);
        } else {
          omittedAudioTracks += 1;
        }
        continue;
      }

      if (stream.codec_type === 'subtitle') {
        const relativeIndex = subtitleIndex;
        subtitleIndex += 1;
        const codecName = String(stream.codec_name ?? '').toLowerCase();
        if (!SUPPORTED_SUBTITLE_CODECS.has(codecName)) continue;

        if (subtitleTracks.length < MAX_TRACKS_PER_TYPE) {
          subtitleTracks.push(createMediaTrack(stream, relativeIndex));
        } else {
          omittedSubtitleTracks += 1;
        }
      }
    }

    const warnings: string[] = [];
    if (omittedAudioTracks > 0) {
      warnings.push(
        `Ignored ${omittedAudioTracks} audio track(s) above the ${MAX_TRACKS_PER_TYPE}-track limit`,
      );
    }
    if (omittedSubtitleTracks > 0) {
      warnings.push(
        `Ignored ${omittedSubtitleTracks} supported subtitle track(s) above the ${MAX_TRACKS_PER_TYPE}-track limit`,
      );
    }

    return {
      audioTracks,
      subtitleTracks,
      probeWarning: warnings.length > 0 ? warnings.join('; ') : null,
    };
  } catch (error) {
    if (signal.aborted) throw error;

    const fallback = getFallbackMediaInfo();
    fallback.probeWarning =
      `ffprobe metadata discovery failed; using the first audio track only: ${formatError(error)}`;
    return fallback;
  }
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

function getTagValue(
  tags: Record<string, unknown> | undefined,
  wantedName: string,
): string | null {
  if (!tags) return null;

  for (const [name, value] of Object.entries(tags)) {
    if (name.toLowerCase() !== wantedName || typeof value !== 'string') {
      continue;
    }
    const safeValue = sanitizeMetadataValue(value);
    return safeValue || null;
  }
  return null;
}

function isEnabledDisposition(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

async function runFfprobe(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<FfprobeResult> {
  if (signal.aborted) {
    throw createAbortError('Media metadata probing was aborted');
  }

  return new Promise<FfprobeResult>((resolve, reject) => {
    const ffprobe = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-rw_timeout',
        '15000000',
        '-user_agent',
        USER_AGENT,
        '-probesize',
        '10485760',
        '-analyzeduration',
        '10000000',
        '-show_entries',
        'stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition=default,forced',
        '-of',
        'json',
        sourceUrl,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let settled = false;
    let stdout = '';
    let stdoutBytes = 0;
    let stderr = '';

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
    };
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminateProcessTree(ffprobe, 'SIGTERM');
      reject(error);
    };
    const handleAbort = () => {
      finishWithError(createAbortError('Media metadata probing was aborted'));
    };
    const timeout = setTimeout(() => {
      finishWithError(
        new Error(`ffprobe exceeded its ${FFPROBE_TIMEOUT_MS}ms timeout`),
      );
    }, FFPROBE_TIMEOUT_MS);
    timeout.unref();

    signal.addEventListener('abort', handleAbort, { once: true });

    ffprobe.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > FFPROBE_MAX_OUTPUT_BYTES) {
        finishWithError(
          new Error(
            `ffprobe output exceeded ${FFPROBE_MAX_OUTPUT_BYTES} bytes`,
          ),
        );
        return;
      }
      stdout += chunk.toString();
    });

    ffprobe.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stderr = `${stderr}${chunk.toString()}`.slice(-4096);
    });

    ffprobe.once('error', (error) => {
      finishWithError(new Error(`Unable to launch ffprobe: ${error.message}`));
    });

    ffprobe.once('close', (code, closeSignal) => {
      if (settled) return;
      if (code !== 0) {
        finishWithError(
          new Error(
            stderr.trim() ||
              `ffprobe exited with code ${String(code)} and signal ${String(closeSignal)}`,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as FfprobeResult;
        if (!Array.isArray(parsed.streams)) {
          throw new Error('ffprobe returned no stream list');
        }
        settled = true;
        cleanup();
        resolve(parsed);
      } catch (error) {
        finishWithError(
          new Error(`Could not parse ffprobe output: ${formatError(error)}`),
        );
      }
    });
  });
}

function getOutputTrackMetadataArgs(
  type: 'a' | 's',
  outputIndex: number,
  track: MediaTrack,
): string[] {
  const args: string[] = [];
  if (track.language) {
    args.push(
      `-metadata:s:${type}:${outputIndex}`,
      `language=${getSafeLanguage(track.language)}`,
    );
  }
  if (track.title) {
    args.push(
      `-metadata:s:${type}:${outputIndex}`,
      `title=${sanitizeMetadataValue(track.title)}`,
    );
  }

  const dispositions = [
    track.isDefault ? 'default' : '',
    track.isForced ? 'forced' : '',
  ].filter(Boolean);
  args.push(
    `-disposition:${type}:${outputIndex}`,
    dispositions.length > 0 ? dispositions.join('+') : '0',
  );
  return args;
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

async function pumpOrderedRanges(
  sourceUrl: string,
  contentLength: number,
  stdin: Writable,
  controller: AbortController,
): Promise<void> {
  const { signal } = controller;
  const chunkCount = Math.ceil(contentLength / RANGE_CHUNK_BYTES);
  const inFlight = new Map<number, Promise<RangeChunkResult>>();
  let nextToLaunch = 0;

  const launch = (index: number) => {
    const start = index * RANGE_CHUNK_BYTES;
    const end = Math.min(start + RANGE_CHUNK_BYTES, contentLength) - 1;

    // Convert rejection into a tagged result immediately. Later ranges can
    // finish before the ordered consumer reaches them, and a tagged promise
    // cannot create an unhandled rejection in that interval.
    const pending: Promise<RangeChunkResult> = fetchRangeChunk(
      sourceUrl,
      start,
      end,
      contentLength,
      signal,
    ).then(
      (chunk): RangeChunkResult => ({ ok: true, chunk }),
      (error: unknown): RangeChunkResult => ({ ok: false, error }),
    );

    inFlight.set(index, pending);
    nextToLaunch += 1;
  };

  while (nextToLaunch < Math.min(RANGE_CONCURRENCY, chunkCount)) {
    launch(nextToLaunch);
  }

  for (let index = 0; index < chunkCount; index += 1) {
    if (signal.aborted) {
      throw createAbortError('Parallel range input was aborted');
    }

    const pending = inFlight.get(index);
    if (!pending) {
      throw new Error(`Range input scheduler lost chunk ${index}`);
    }

    const result = await pending;
    inFlight.delete(index);

    if (!result.ok) throw result.error;

    // Do not launch the replacement until this chunk has been consumed. The
    // current buffer plus the remaining promises therefore never exceeds the
    // configured eight-chunk (16 MiB) window.
    await writeWithBackpressure(stdin, result.chunk, signal);

    if (nextToLaunch < chunkCount) {
      launch(nextToLaunch);
    }
  }

  if (signal.aborted) {
    throw createAbortError('Parallel range input was aborted');
  }

  stdin.end();
}

async function fetchRangeChunk(
  sourceUrl: string,
  start: number,
  end: number,
  contentLength: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(sourceUrl, {
    redirect: 'follow',
    headers: {
      Range: `bytes=${start}-${end}`,
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'identity',
    },
    signal,
    cache: 'no-store',
  });

  const expectedLength = end - start + 1;
  const expectedRange = `bytes ${start}-${end}/${contentLength}`;

  // Validate status and headers before consuming the response. In particular,
  // a server that ignores Range and returns 200 may be sending the entire movie
  // and must never be accepted into arrayBuffer().
  if (
    response.status !== 206 ||
    response.headers.get('content-range') !== expectedRange ||
    response.headers.get('content-length') !== String(expectedLength)
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // The validation error below is the actionable failure.
    }

    throw new Error(
      `Invalid range response for bytes ${start}-${end}: ` +
        `status ${response.status}, Content-Range ${String(response.headers.get('content-range'))}, ` +
        `Content-Length ${String(response.headers.get('content-length'))}`,
    );
  }

  const chunk = new Uint8Array(await response.arrayBuffer());
  if (chunk.byteLength !== expectedLength) {
    throw new Error(
      `Truncated range response for bytes ${start}-${end}: ` +
        `received ${chunk.byteLength} of ${expectedLength} bytes`,
    );
  }

  return chunk;
}

async function writeWithBackpressure(
  stdin: Writable,
  chunk: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw createAbortError('Parallel range input was aborted');
  }
  if (stdin.destroyed || stdin.writableEnded || !stdin.writable) {
    throw new Error('FFmpeg input pipe closed before the source was complete');
  }

  let canContinue: boolean;
  try {
    canContinue = stdin.write(chunk);
  } catch (error) {
    throw new Error(`Could not write to FFmpeg input: ${formatError(error)}`);
  }

  if (canContinue) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stdin.removeListener('drain', handleDrain);
      stdin.removeListener('error', handleError);
      stdin.removeListener('close', handleClose);
      signal.removeEventListener('abort', handleAbort);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleClose = () => {
      cleanup();
      reject(new Error('FFmpeg input pipe closed during backpressure'));
    };
    const handleAbort = () => {
      cleanup();
      reject(createAbortError('Parallel range input was aborted'));
    };

    stdin.once('drain', handleDrain);
    stdin.once('error', handleError);
    stdin.once('close', handleClose);
    signal.addEventListener('abort', handleAbort, { once: true });

    // Close the small race between the initial check and listener attachment.
    if (signal.aborted) handleAbort();
  });
}

function appendSessionDiagnostic(session: HlsSession, message: string): void {
  session.stderr = `${session.stderr}\n${message}`.slice(-16 * 1024);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

async function waitForManifest(
  session: HlsSession,
  timeoutMs: number,
): Promise<{ manifest?: string; error?: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const manifest = await readValidManifest(session);
    if (manifest) {
      session.hasProducedManifest = true;
      return { manifest };
    }

    if (session.startupError) {
      return { error: session.startupError };
    }

    await delay(250);
  }

  const manifest = await readValidManifest(session);
  if (manifest) {
    session.hasProducedManifest = true;
    return { manifest };
  }

  return session.startupError ? { error: session.startupError } : {};
}

async function readValidManifest(session: HlsSession): Promise<string | null> {
  try {
    const manifest = await readFile(session.playlistPath, 'utf8');
    if (!manifest.startsWith('#EXTM3U')) return null;

    const lines = manifest.split(/\r?\n/);
    const variantPlaylistNames = lines
      .map((line) => line.trim())
      .filter((line) => AV_PLAYLIST_NAME_PATTERN.test(line));
    const audioPlaylistNames = lines
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.startsWith('#EXT-X-MEDIA:') &&
          getHlsAttribute(line, 'TYPE') === 'AUDIO',
      )
      .map((line) => getHlsAttribute(line, 'URI'))
      .filter((name): name is string => name !== null);

    const referencedPlaylists = Array.from(
      new Set([...variantPlaylistNames, ...audioPlaylistNames]),
    );
    const expectedPlaylists = [
      'stream-0.m3u8',
      ...session.mediaInfo.audioTracks.map(
        (_track, index) => `stream-${index + 1}.m3u8`,
      ),
    ];

    if (
      referencedPlaylists.length !== expectedPlaylists.length ||
      expectedPlaylists.some((name) => !referencedPlaylists.includes(name)) ||
      referencedPlaylists.some((name) => !AV_PLAYLIST_NAME_PATTERN.test(name))
    ) {
      return null;
    }

    const playlistsReady = await Promise.all(
      referencedPlaylists.map((name) =>
        readValidAvPlaylist(session.directory, name),
      ),
    );
    return playlistsReady.every(Boolean) ? manifest : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EBUSY') {
      return null;
    }
    throw error;
  }
}

async function readValidAvPlaylist(
  directory: string,
  playlistName: string,
): Promise<boolean> {
  const playlistMatch = AV_PLAYLIST_NAME_PATTERN.exec(playlistName);
  if (!playlistMatch) return false;

  try {
    const streamIndex = playlistMatch[1];
    const manifest = await readFile(path.join(directory, playlistName), 'utf8');
    if (!manifest.startsWith('#EXTM3U')) return false;

    const lines = manifest.split(/\r?\n/).map((line) => line.trim());
    const segmentNames = lines.filter(
      (line) => line !== '' && !line.startsWith('#'),
    );
    const mapLines = lines.filter((line) => line.startsWith('#EXT-X-MAP:'));
    const expectedInitName = `init-${streamIndex}.mp4`;

    if (
      segmentNames.length === 0 ||
      segmentNames.some((name) => {
        const match = AV_SEGMENT_NAME_PATTERN.exec(name);
        return !match || match[1] !== streamIndex;
      }) ||
      mapLines.length !== 1 ||
      getMapUri(mapLines[0]) !== expectedInitName
    ) {
      return false;
    }

    // temp_file publishes each playlist entry only after the fragment rename.
    // Checking both the init file and latest fragment protects readers from a
    // partially published fMP4 rendition during startup.
    const [initStat, segmentStat] = await Promise.all([
      stat(path.join(directory, expectedInitName)),
      stat(path.join(directory, segmentNames[segmentNames.length - 1])),
    ]);
    return (
      initStat.isFile() &&
      initStat.size > 0 &&
      segmentStat.isFile() &&
      segmentStat.size > 0
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EBUSY') {
      return false;
    }
    throw error;
  }
}

function rewriteMasterManifest(manifest: string, session: HlsSession): string {
  const audioLabels = getUniqueTrackLabels(
    session.mediaInfo.audioTracks,
    'Audio',
  );
  const subtitleLabels = getUniqueTrackLabels(
    session.mediaInfo.subtitleTracks,
    'Subtitle',
  );
  const audioDefaultIndex = getDefaultTrackIndex(session.mediaInfo.audioTracks);
  const subtitleMediaLines = session.mediaInfo.subtitleTracks.map(
    (track, index) =>
      [
        '#EXT-X-MEDIA:TYPE=SUBTITLES',
        'GROUP-ID="subs"',
        `NAME="${subtitleLabels[index]}"`,
        `LANGUAGE="${getSafeLanguage(track.language)}"`,
        'DEFAULT=NO',
        'AUTOSELECT=YES',
        `FORCED=${track.isForced ? 'YES' : 'NO'}`,
        `URI="subtitle-${index}.m3u8"`,
      ].join(','),
  );

  const rewrittenLines: string[] = [];
  let insertedSubtitles = false;
  for (const originalLine of manifest.split(/\r?\n/)) {
    let line = originalLine;
    if (
      line.startsWith('#EXT-X-MEDIA:') &&
      getHlsAttribute(line, 'TYPE') === 'AUDIO'
    ) {
      const playlistName = getHlsAttribute(line, 'URI');
      const playlistMatch = playlistName
        ? AV_PLAYLIST_NAME_PATTERN.exec(playlistName)
        : null;
      const audioIndex = playlistMatch ? Number(playlistMatch[1]) - 1 : -1;
      const track = session.mediaInfo.audioTracks[audioIndex];
      if (track) {
        line = setHlsAttribute(line, 'NAME', audioLabels[audioIndex], true);
        line = setHlsAttribute(
          line,
          'LANGUAGE',
          getSafeLanguage(track.language),
          true,
        );
        line = setHlsAttribute(
          line,
          'DEFAULT',
          audioIndex === audioDefaultIndex ? 'YES' : 'NO',
          false,
        );
        line = setHlsAttribute(line, 'AUTOSELECT', 'YES', false);
      }
    }

    if (
      !insertedSubtitles &&
      subtitleMediaLines.length > 0 &&
      line.startsWith('#EXT-X-STREAM-INF:')
    ) {
      rewrittenLines.push(...subtitleMediaLines);
      insertedSubtitles = true;
    }
    if (
      subtitleMediaLines.length > 0 &&
      line.startsWith('#EXT-X-STREAM-INF:')
    ) {
      line = setHlsAttribute(line, 'SUBTITLES', 'subs', true);
    }
    rewrittenLines.push(line);
  }

  if (!insertedSubtitles && subtitleMediaLines.length > 0) {
    rewrittenLines.push(...subtitleMediaLines);
  }

  return rewritePlaylistAssetReferences(
    rewrittenLines.join('\n'),
    session.id,
  );
}

function rewritePlaylistAssetReferences(
  manifest: string,
  sessionId: string,
): string {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const asset = line.trim();
      if (HLS_ASSET_NAME_PATTERN.test(asset)) {
        return getAssetUrl(sessionId, asset);
      }

      return line.replace(/URI="([^"]+)"/g, (match, uri: string) =>
        HLS_ASSET_NAME_PATTERN.test(uri)
          ? `URI="${getAssetUrl(sessionId, uri)}"`
          : match,
      );
    })
    .join('\n');
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

function getHlsAttribute(line: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(
    new RegExp(`(?:^|[:,])${escapedName}=(?:"([^"]*)"|([^,]*))`),
  );
  return match ? (match[1] ?? match[2]?.trim() ?? '') : null;
}

function setHlsAttribute(
  line: string,
  name: string,
  value: string,
  quoted: boolean,
): string {
  const safeValue = quoted ? sanitizeMetadataValue(value) : value;
  const formatted = quoted ? `"${safeValue}"` : safeValue;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`([:,])${escapedName}=(?:"[^"]*"|[^,]*)`);
  return pattern.test(line)
    ? line.replace(pattern, (_match, prefix: string) =>
        `${prefix}${name}=${formatted}`,
      )
    : `${line},${name}=${formatted}`;
}

function getMapUri(line: string): string | null {
  const prefix = '#EXT-X-MAP:';
  if (!line.startsWith(prefix)) return null;

  const attributes = line.slice(prefix.length);
  const match = attributes.match(/(?:^|,)\s*URI="([^"]+)"(?=\s*(?:,|$))/);
  return match?.[1] ?? null;
}

function getAssetUrl(sessionId: string, assetName: string): string {
  return `?session=${encodeURIComponent(sessionId)}&asset=${encodeURIComponent(assetName)}`;
}

async function serveAsset(
  sessionId: string | null,
  assetName: string | null,
): Promise<NextResponse> {
  if (!sessionId || !assetName) {
    return NextResponse.json(
      { error: 'Both session and asset parameters are required' },
      { status: 400 },
    );
  }

  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session identifier' }, { status: 400 });
  }

  if (!HLS_ASSET_NAME_PATTERN.test(assetName)) {
    return NextResponse.json({ error: 'Invalid HLS asset name' }, { status: 400 });
  }

  const session = sessionStore.sessions.get(sessionId);
  if (!session || session.closing) {
    return NextResponse.json({ error: 'HLS session not found' }, { status: 404 });
  }

  session.lastAccess = Date.now();
  const assetPath = path.resolve(session.directory, assetName);
  if (path.dirname(assetPath) !== session.directory) {
    return NextResponse.json({ error: 'Invalid HLS asset path' }, { status: 400 });
  }

  try {
    const data = await readFile(assetPath);
    if (data.length === 0) {
      return NextResponse.json({ error: 'HLS asset is not ready' }, { status: 404 });
    }

    session.lastAccess = Date.now();
    if (assetName.endsWith('.m3u8')) {
      const manifest = data.toString('utf8');
      if (!manifest.startsWith('#EXTM3U')) {
        return NextResponse.json(
          { error: 'Invalid HLS playlist' },
          { status: 502 },
        );
      }
      const rewritten =
        assetName === MASTER_PLAYLIST_NAME
          ? rewriteMasterManifest(manifest, session)
          : rewritePlaylistAssetReferences(manifest, session.id);
      return createPlaylistResponse(rewritten, session.id);
    }

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': getHlsAssetContentType(assetName),
        'Content-Length': String(data.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'X-HLS-Session': session.id,
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EBUSY') {
      // Subtitle outputs do not necessarily receive a packet near timestamp
      // zero. An empty live playlist lets HLS clients poll until FFmpeg writes
      // the real WebVTT segment list instead of permanently rejecting the
      // subtitle rendition after an early 404.
      if (SUBTITLE_PLAYLIST_NAME_PATTERN.test(assetName)) {
        return createPlaylistResponse(
          '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n',
          session.id,
        );
      }
      return NextResponse.json({ error: 'HLS asset not found' }, { status: 404 });
    }
    throw error;
  }
}

function createPlaylistResponse(
  manifest: string,
  sessionId: string,
): NextResponse {
  return new NextResponse(manifest, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': String(Buffer.byteLength(manifest)),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'X-HLS-Session': sessionId,
    },
  });
}

function getHlsAssetContentType(assetName: string): string {
  if (SUBTITLE_SEGMENT_NAME_PATTERN.test(assetName)) {
    return 'text/vtt; charset=utf-8';
  }
  if (AV_INIT_NAME_PATTERN.test(assetName)) return 'video/mp4';
  if (AV_SEGMENT_NAME_PATTERN.test(assetName)) return 'video/iso.segment';
  return 'application/octet-stream';
}

async function removeIdleSessions(): Promise<void> {
  const now = Date.now();
  const idleSessions = Array.from(sessionStore.sessions.values()).filter(
    (session) => !session.closing && now - session.lastAccess > SESSION_IDLE_MS,
  );

  await Promise.all(
    idleSessions.map((session) =>
      cleanupSession(session).catch((error) => {
        console.error(`Failed to clean HLS session ${session.id}:`, error);
      }),
    ),
  );
}

function cleanupSession(session: HlsSession): Promise<void> {
  if (session.cleanupPromise) return session.cleanupPromise;

  session.closing = true;
  session.cleanupPromise = (async () => {
    // initializeSession installs the controller before its first await, so this
    // also interrupts a slow HEAD probe during teardown.
    session.inputAbortController?.abort();
    await session.startPromise;
    session.inputAbortController?.abort();
    await stopFfmpeg(session.ffmpeg);
    await session.inputPumpPromise;

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

async function stopFfmpeg(
  ffmpeg: ChildProcess | null,
): Promise<void> {
  if (!ffmpeg || ffmpeg.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceKillTimer);
      resolve();
    };

    ffmpeg.once('close', finish);
    const forceKillTimer = setTimeout(() => {
      if (ffmpeg.exitCode === null) {
        terminateProcessTree(ffmpeg, 'SIGKILL');
      }
      finish();
    }, 3000);
    forceKillTimer.unref();

    terminateProcessTree(ffmpeg, 'SIGTERM');
  });
}

function terminateProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  const terminateChild = () => {
    try {
      child.kill(signal);
    } catch {
      // The process may have exited immediately before termination.
    }
  };

  if (process.platform !== 'win32' || !child.pid) {
    terminateChild();
    return;
  }

  // Chocolatey's ffmpeg.exe/ffprobe.exe are shims which launch the real
  // binaries as descendants. Killing only the shim leaves the encoder alive,
  // still writing into a session that is being removed. Terminate the exact
  // process tree on Windows so client disconnects cannot orphan FFmpeg.
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

function getSessionDirectory(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Unsafe HLS session identifier');
  }

  return path.resolve(CACHE_ROOT, sessionId);
}

function assertSafeSessionDirectory(directory: string, sessionId: string): void {
  const expected = getSessionDirectory(sessionId);
  if (directory !== expected || path.dirname(directory) !== CACHE_ROOT) {
    throw new Error('Unsafe HLS cache directory');
  }
}

function getFfmpegDiagnostic(session: HlsSession): string {
  return session.stderr
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-8)
    .join('\n')
    .slice(-4000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
