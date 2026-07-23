function replaceRequired(source, name, pattern, replacement) {
  if (source.includes(replacement)) return source;
  const patched = source.replace(pattern, replacement);
  if (patched === source) {
    throw new Error(`Could not locate the expected ${name} block.`);
  }
  return patched;
}

function patchLinearTimelineRoute(source) {
  let patched = source;

  patched = replaceRequired(
    patched,
    'long sequential segment wait',
    'const SEGMENT_WAIT_MS = 180 * 1000;',
    'const SEGMENT_WAIT_MS = 12 * 60 * 1000;',
  );

  patched = replaceRequired(
    patched,
    'linear segment duration constant',
    'const FILE_POLL_MS = 150;',
    'const FILE_POLL_MS = 150;\nconst SEGMENT_DURATION_SECONDS = 4;',
  );

  patched = replaceRequired(
    patched,
    'linear session duration fields',
    '  stderr: string;\n  startPromise: Promise<void>;',
    '  stderr: string;\n  durationSeconds: number | null;\n  generatedSeconds: number;\n  startPromise: Promise<void>;',
  );

  patched = replaceRequired(
    patched,
    'linear session duration initialization',
    "    stderr: '',\n    startPromise: Promise.resolve(),",
    "    stderr: '',\n    durationSeconds: null,\n    generatedSeconds: 0,\n    startPromise: Promise.resolve(),",
  );

  const stderrOriginal = [
    "  child.stderr.on('data', (chunk: string) => {",
    '    session.stderr = `${session.stderr}${chunk}`.slice(-16000);',
    "    if (process.env.STREAM_DEBUG === '1') {",
    '      chunk',
    '        .split(/\\r?\\n/)',
    '        .filter(Boolean)',
    '        .forEach((line) => console.log(`[stream-linear][ffmpeg][${session.id}] ${line}`));',
    '    }',
    '  });',
  ].join('\n');

  const stderrReplacement = [
    "  child.stderr.on('data', (chunk: string) => {",
    '    const text = String(chunk);',
    '    session.stderr = `${session.stderr}${text}`.slice(-16000);',
    '    captureLinearProgress(session);',
    "    if (process.env.STREAM_DEBUG === '1') {",
    '      text',
    '        .split(/\\r?\\n/)',
    '        .filter(Boolean)',
    '        .forEach((line) => console.log(`[stream-linear][ffmpeg][${session.id}] ${line}`));',
    '    }',
    '  });',
  ].join('\n');

  patched = replaceRequired(
    patched,
    'FFmpeg duration and progress capture',
    stderrOriginal,
    stderrReplacement,
  );

  const playlistPattern = /async function playlistResponse\(session: LinearSession\): Promise<NextResponse> \{[\s\S]*?\n\}\n\nfunction safeAssetPath/;
  const playlistReplacement = `function clockToSeconds(hours: string, minutes: string, seconds: string): number {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function captureLinearProgress(session: LinearSession): void {
  if (session.durationSeconds === null) {
    const durationMatch = /Duration:\\s*(\\d{2}):(\\d{2}):(\\d{2}(?:\\.\\d+)?)/.exec(
      session.stderr,
    );
    if (durationMatch) {
      const duration = clockToSeconds(durationMatch[1], durationMatch[2], durationMatch[3]);
      if (Number.isFinite(duration) && duration > 0) session.durationSeconds = duration;
    }
  }

  const progressMatches = Array.from(
    session.stderr.matchAll(/time=(\\d{2}):(\\d{2}):(\\d{2}(?:\\.\\d+)?)/g),
  );
  const latest = progressMatches.at(-1);
  if (latest) {
    const generated = clockToSeconds(latest[1], latest[2], latest[3]);
    if (Number.isFinite(generated) && generated > session.generatedSeconds) {
      session.generatedSeconds = generated;
    }
  }
}

function parsePublishedSegmentDurations(source: string): Map<number, number> {
  const durations = new Map<number, number>();
  let pendingDuration: number | null = null;

  for (const rawLine of source.split(/\\r?\\n/)) {
    const line = rawLine.trim();
    const durationMatch = /^#EXTINF:([0-9.]+)/.exec(line);
    if (durationMatch) {
      const value = Number(durationMatch[1]);
      pendingDuration = Number.isFinite(value) && value > 0 ? value : null;
      continue;
    }

    const segmentMatch = /^segment-(\\d{6})\\.ts$/.exec(line);
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

function rewritePublishedPlaylist(session: LinearSession, source: string): string {
  return source.replace(
    /^(segment-\\d{6}\\.ts)$/gm,
    (_match, asset: string) =>
      \`/api/playback-linear?session=\${encodeURIComponent(session.id)}&asset=\${encodeURIComponent(asset)}\`,
  );
}

function createFullTimelinePlaylist(session: LinearSession, source: string): string {
  const duration = session.durationSeconds;
  if (!(duration && Number.isFinite(duration) && duration > 0)) {
    return rewritePublishedPlaylist(session, source);
  }

  const publishedDurations = parsePublishedSegmentDurations(source);
  const segmentCount = Math.max(1, Math.ceil(duration / SEGMENT_DURATION_SECONDS));
  const publishedMaximum = Math.max(0, ...publishedDurations.values());
  const targetDuration = Math.max(
    SEGMENT_DURATION_SECONDS,
    Math.ceil(publishedMaximum || SEGMENT_DURATION_SECONDS),
  );
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    \`#EXT-X-TARGETDURATION:\${targetDuration}\`,
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
    const asset = \`segment-\${String(index).padStart(6, '0')}.ts\`;
    lines.push(\`#EXTINF:\${segmentDuration.toFixed(6)},\`);
    lines.push(
      \`/api/playback-linear?session=\${encodeURIComponent(session.id)}&asset=\${encodeURIComponent(asset)}\`,
    );
  }

  lines.push('#EXT-X-ENDLIST');
  return \`\${lines.join('\\n')}\\n\`;
}

async function playlistResponse(session: LinearSession): Promise<NextResponse> {
  const source = await readFile(session.playlistPath, 'utf8');
  const playlist = createFullTimelinePlaylist(session, source);

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
    },
  });
}

function safeAssetPath`;

  if (!playlistPattern.test(patched)) {
    throw new Error('Could not locate the expected linear playlist response block.');
  }
  patched = patched.replace(playlistPattern, playlistReplacement);

  return patched;
}

function patchLinearTimelinePlayer(source) {
  let patched = source;

  patched = patched.replace(
    '            maxTimeToFirstByteMs: 150_000,\n            maxLoadTimeMs: 210_000,',
    '            maxTimeToFirstByteMs: 10 * 60_000,\n            maxLoadTimeMs: 11 * 60_000,',
  );

  patched = patched.replace(
    /  const activePlaybackIsHls = activePlaybackSource\n    \? getPlaybackUrl\(activePlaybackSource\)\.isHls\n    : false;/,
    '  const activePlaybackIsHls = activePlaybackTarget?.isHls ?? false;',
  );

  return patched;
}

module.exports = {
  patchLinearTimelinePlayer,
  patchLinearTimelineRoute,
};
