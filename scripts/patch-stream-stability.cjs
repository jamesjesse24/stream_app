function replaceRequired(source, name, original, replacement) {
  if (source.includes(replacement)) return source;
  const patched = source.replace(original, replacement);
  if (patched === source) {
    throw new Error(`Could not locate the expected ${name} block.`);
  }
  return patched;
}

function patchStreamStabilityRoute(source) {
  if (
    source.includes('function shiftWebVttTimestamps(') &&
    source.includes('mediaIdentities: Map<string, string>;')
  ) {
    return source;
  }

  let patched = source;

  patched = replaceRequired(
    patched,
    'linear session media identity field',
    '  generatedSeconds: number;\n  subtitleTrack: SubtitleTrack | null;',
    '  generatedSeconds: number;\n  mediaIdentity: string | null;\n  subtitleTrack: SubtitleTrack | null;',
  );

  patched = replaceRequired(
    patched,
    'linear store media identity map',
    'interface LinearStore {\n  sessions: Map<string, LinearSession>;\n  cleanupTimer?: NodeJS.Timeout;\n}',
    'interface LinearStore {\n  sessions: Map<string, LinearSession>;\n  mediaIdentities: Map<string, string>;\n  cleanupTimer?: NodeJS.Timeout;\n}',
  );

  patched = replaceRequired(
    patched,
    'linear store initialization',
    '    sessions: new Map<string, LinearSession>(),\n  });',
    '    sessions: new Map<string, LinearSession>(),\n    mediaIdentities: new Map<string, string>(),\n  });',
  );

  patched = replaceRequired(
    patched,
    'asset request forwarding',
    '      return await serveAsset(sessionId, asset);',
    '      return await serveAsset(request, sessionId, asset);',
  );

  patched = replaceRequired(
    patched,
    'asset handler request argument',
    'async function serveAsset(\n  sessionId: string | null,\n  asset: string | null,\n): Promise<NextResponse> {',
    'async function serveAsset(\n  request: NextRequest,\n  sessionId: string | null,\n  asset: string | null,\n): Promise<NextResponse> {',
  );

  patched = replaceRequired(
    patched,
    'linear session media identity initialization',
    '    generatedSeconds: 0,\n    subtitleTrack: null,',
    '    generatedSeconds: 0,\n    mediaIdentity: null,\n    subtitleTrack: null,',
  );

  patched = replaceRequired(
    patched,
    'duplicate media session cleanup',
    [
      '  if (!response.ok || !response.body) {',
      '    await response.body?.cancel().catch(() => undefined);',
      '    throw new HttpError(',
      '      502,',
      '      `Source download failed with HTTP ${response.status} ${response.statusText}`,',
      '    );',
      '  }',
      '',
      "  const ffmpeg = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg';",
    ].join('\n'),
    [
      '  if (!response.ok || !response.body) {',
      '    await response.body?.cancel().catch(() => undefined);',
      '    throw new HttpError(',
      '      502,',
      '      `Source download failed with HTTP ${response.status} ${response.statusText}`,',
      '    );',
      '  }',
      '',
      '  const mediaIdentity = createMediaIdentity(response, session.transcode);',
      '  if (mediaIdentity) {',
      '    session.mediaIdentity = mediaIdentity;',
      '    const previousId = store.mediaIdentities.get(mediaIdentity);',
      '    if (previousId && previousId !== session.id) {',
      '      const previous = store.sessions.get(previousId);',
      '      if (previous) {',
      "        if (process.env.STREAM_DEBUG === '1') {",
      '          console.log(`[stream-linear] replacing duplicate media session ${previous.id} with ${session.id}`);',
      '        }',
      '        await cleanupSession(previous);',
      '      }',
      '    }',
      '    store.mediaIdentities.set(mediaIdentity, session.id);',
      '  }',
      '',
      "  const ffmpeg = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg';",
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'WebVTT offset response',
    [
      '  const body = await readFile(assetPath);',
      '  return new NextResponse(body, {',
      '    status: 200,',
      '    headers: {',
      "      'Cache-Control': 'private, max-age=31536000, immutable',",
      "      'Content-Length': String(body.byteLength),",
      "      'Content-Type': contentTypeForAsset(asset),",
      "      'X-Accel-Buffering': 'no',",
      "      'X-Linear-Session': session.id,",
      '    },',
      '  });',
    ].join('\n'),
    [
      "  if (asset.endsWith('.vtt')) {",
      "    const source = await readFile(assetPath, 'utf8');",
      '    const offset = parseSubtitleOffset(request.nextUrl.searchParams.get(\'offset\'));',
      '    const body = shiftWebVttTimestamps(source, offset);',
      '    return new NextResponse(body, {',
      '      status: 200,',
      '      headers: {',
      "        'Cache-Control': 'private, no-store, max-age=0',",
      "        'Content-Length': String(Buffer.byteLength(body, 'utf8')),",
      "        'Content-Type': 'text/vtt; charset=utf-8',",
      "        'X-Accel-Buffering': 'no',",
      "        'X-Linear-Session': session.id,",
      "        'X-Subtitle-Offset': String(offset),",
      '      },',
      '    });',
      '  }',
      '',
      '  const body = await readFile(assetPath);',
      '  return new NextResponse(body, {',
      '    status: 200,',
      '    headers: {',
      "      'Cache-Control': 'private, max-age=31536000, immutable',",
      "      'Content-Length': String(body.byteLength),",
      "      'Content-Type': contentTypeForAsset(asset),",
      "      'X-Accel-Buffering': 'no',",
      "      'X-Linear-Session': session.id,",
      '    },',
      '  });',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'subtitle offset and media identity helpers',
    'function validateSourceUrl(value: string): string {',
    `function parseSubtitleOffset(value: string | null): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.max(-5, Math.min(5, parsed)) * 100) / 100;
}

function shiftWebVttTimestamps(source: string, offsetSeconds: number): string {
  if (Math.abs(offsetSeconds) < 0.001) return source;

  const timestampPattern = /\\b(?:(\\d{1,3}):)?(\\d{2}):(\\d{2})\\.(\\d{3})\\b/g;
  return source
    .split(/\\r?\\n/)
    .map((line) => {
      if (!line.includes('-->')) return line;
      return line.replace(
        timestampPattern,
        (_match, hoursValue, minutesValue, secondsValue, millisecondsValue) => {
          const hadHours = typeof hoursValue === 'string';
          const hours = hadHours ? Number(hoursValue) : 0;
          const minutes = Number(minutesValue);
          const seconds = Number(secondsValue);
          const milliseconds = Number(millisecondsValue);
          const originalMilliseconds =
            ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
          const shiftedMilliseconds = Math.max(
            0,
            Math.round(originalMilliseconds + offsetSeconds * 1000),
          );
          return formatWebVttTimestamp(shiftedMilliseconds, hadHours);
        },
      );
    })
    .join('\\n');
}

function formatWebVttTimestamp(totalMilliseconds: number, forceHours: boolean): string {
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const suffix = \`\${String(seconds).padStart(2, '0')}.\${String(milliseconds).padStart(3, '0')}\`;
  if (forceHours || hours > 0) {
    return \`\${String(hours).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:\${suffix}\`;
  }
  return \`\${String(totalMinutes).padStart(2, '0')}:\${suffix}\`;
}

function createMediaIdentity(response: Response, transcode: boolean): string | null {
  const length = response.headers.get('content-length')?.trim() ?? '';
  const disposition = response.headers.get('content-disposition')?.trim() ?? '';
  const etag = response.headers.get('etag')?.trim() ?? '';
  if (!length && !disposition && !etag) return null;

  const value = [transcode ? 'transcode' : 'copy', length, disposition, etag].join('\\0');
  return createHash('sha256').update(value).digest('hex');
}

function validateSourceUrl(value: string): string {`,
  );

  patched = replaceRequired(
    patched,
    'media identity cleanup',
    '  store.sessions.delete(session.id);\n  session.controller.abort();',
    [
      '  store.sessions.delete(session.id);',
      '  if (',
      '    session.mediaIdentity &&',
      '    store.mediaIdentities.get(session.mediaIdentity) === session.id',
      '  ) {',
      '    store.mediaIdentities.delete(session.mediaIdentity);',
      '  }',
      '  session.controller.abort();',
    ].join('\n'),
  );

  return patched;
}

function patchStreamStabilityPlayer(source) {
  if (
    source.includes('class SubtitleOffsetLoader extends BaseLoader') &&
    source.includes("window.addEventListener('uhd:subtitle-delay-change'")
  ) {
    return source;
  }

  let patched = source;

  patched = replaceRequired(
    patched,
    'subtitle timing refs',
    '  const subtitleObjectUrlRef = useRef<string | null>(null);',
    [
      '  const subtitleObjectUrlRef = useRef<string | null>(null);',
      '  const subtitleDelayRef = useRef(0);',
      '  const uploadedCueTimingRef = useRef(',
      '    new WeakMap<TextTrackCue, { startTime: number; endTime: number }>(),',
      '  );',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'subtitle delay event handling',
    [
      '  useEffect(() => {',
      '    if (videoRef.current) videoRef.current.playbackRate = playbackRate;',
      '  }, [playbackRate]);',
      '',
      '  useEffect(() => {',
      '    const video = videoRef.current;',
    ].join('\n'),
    [
      '  useEffect(() => {',
      '    if (videoRef.current) videoRef.current.playbackRate = playbackRate;',
      '  }, [playbackRate]);',
      '',
      '  const clearHlsSubtitleCues = useCallback(() => {',
      '    const video = videoRef.current;',
      '    const uploadedTrack = uploadedSubtitleTrackRef.current?.track;',
      '    if (!video) return;',
      '',
      '    for (let trackIndex = 0; trackIndex < video.textTracks.length; trackIndex += 1) {',
      '      const track = video.textTracks[trackIndex];',
      '      if (!track || track === uploadedTrack) continue;',
      '      const cues = track.cues;',
      '      if (!cues) continue;',
      '      for (let cueIndex = cues.length - 1; cueIndex >= 0; cueIndex -= 1) {',
      '        const cue = cues[cueIndex];',
      '        if (!cue) continue;',
      '        try {',
      '          track.removeCue(cue);',
      '        } catch {',
      '          // The browser may already have removed this cue.',
      '        }',
      '      }',
      '    }',
      '  }, []);',
      '',
      '  const applyUploadedSubtitleDelay = useCallback(() => {',
      '    const track = uploadedSubtitleTrackRef.current?.track;',
      '    const cues = track?.cues;',
      '    if (!cues) return;',
      '',
      '    for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {',
      '      const cue = cues[cueIndex];',
      '      if (!cue) continue;',
      '      let original = uploadedCueTimingRef.current.get(cue);',
      '      if (!original) {',
      '        original = { startTime: cue.startTime, endTime: cue.endTime };',
      '        uploadedCueTimingRef.current.set(cue, original);',
      '      }',
      '      const startTime = Math.max(0, original.startTime + subtitleDelayRef.current);',
      '      const endTime = Math.max(startTime + 0.01, original.endTime + subtitleDelayRef.current);',
      '      try {',
      '        cue.startTime = startTime;',
      '        cue.endTime = endTime;',
      '      } catch {',
      '        // Uploaded cue timing can be immutable in some browsers.',
      '      }',
      '    }',
      '  }, []);',
      '',
      '  useEffect(() => {',
      "    const storageKey = 'uhd-player-subtitle-delay:v1';",
      '    try {',
      '      const saved = Number(localStorage.getItem(storageKey));',
      '      if (Number.isFinite(saved)) {',
      '        subtitleDelayRef.current = Math.max(-5, Math.min(5, saved));',
      '      }',
      '    } catch {',
      '      // Storage may be unavailable in private browsing mode.',
      '    }',
      '',
      '    const handleSubtitleDelay = (event: Event) => {',
      '      const nextValue = Number((event as CustomEvent<number>).detail);',
      '      if (!Number.isFinite(nextValue)) return;',
      '      subtitleDelayRef.current = Math.round(Math.max(-5, Math.min(5, nextValue)) * 100) / 100;',
      '',
      "      if (desiredSubtitleSelectionRef.current.kind === 'upload') {",
      '        applyUploadedSubtitleDelay();',
      '        return;',
      '      }',
      '',
      '      const hls = hlsRef.current;',
      '      if (!hls || desiredSubtitleSelectionRef.current.kind !== \'hls\') return;',
      '      const selectedIndex = hls.subtitleTrack;',
      '      if (selectedIndex < 0) return;',
      '',
      '      clearHlsSubtitleCues();',
      '      hls.subtitleDisplay = false;',
      '      hls.subtitleTrack = -1;',
      '      window.setTimeout(() => {',
      '        if (hlsRef.current !== hls) return;',
      '        const track = hls.subtitleTracks[selectedIndex];',
      '        hls.subtitleDisplay = true;',
      '        if (track) hls.setSubtitleOption(track);',
      '        else hls.subtitleTrack = selectedIndex;',
      '      }, 60);',
      '    };',
      '',
      "    window.addEventListener('uhd:subtitle-delay-change', handleSubtitleDelay);",
      '    return () =>',
      "      window.removeEventListener('uhd:subtitle-delay-change', handleSubtitleDelay);",
      '  }, [applyUploadedSubtitleDelay, clearHlsSubtitleCues]);',
      '',
      '  useEffect(() => {',
      '    const video = videoRef.current;',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'subtitle offset loader',
    '    if (playback.isHls && Hls.isSupported()) {\n      hlsInstance = new Hls({',
    [
      '    const BaseLoader = Hls.DefaultConfig.loader;',
      '    class SubtitleOffsetLoader extends BaseLoader {',
      '      load(context: any, config: any, callbacks: any): void {',
      '        let nextContext = context;',
      '        try {',
      '          const url = new URL(context.url, window.location.href);',
      '          const asset = url.searchParams.get(\'asset\');',
      '          if (',
      "            url.pathname === '/api/playback-linear' &&",
      "            asset?.toLowerCase().endsWith('.vtt')",
      '          ) {',
      "            url.searchParams.set('offset', subtitleDelayRef.current.toFixed(2));",
      '            nextContext = { ...context, url: url.toString() };',
      '          }',
      '        } catch {',
      '          // Leave unrelated or malformed loader URLs unchanged.',
      '        }',
      '        super.load(nextContext, config, callbacks);',
      '      }',
      '    }',
      '',
      '    if (playback.isHls && Hls.isSupported()) {',
      '      hlsInstance = new Hls({',
      '        loader: SubtitleOffsetLoader,',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'clear cues when subtitles are disabled',
    "  const selectSubtitlesOff = () => {\n    const selection: SubtitleSelection = { kind: 'off' };",
    "  const selectSubtitlesOff = () => {\n    clearHlsSubtitleCues();\n    const selection: SubtitleSelection = { kind: 'off' };",
  );

  patched = replaceRequired(
    patched,
    'clear cues before built-in subtitle selection',
    '  const selectBuiltInSubtitle = (index: number) => {\n    const hls = hlsRef.current;',
    '  const selectBuiltInSubtitle = (index: number) => {\n    clearHlsSubtitleCues();\n    const hls = hlsRef.current;',
  );

  patched = replaceRequired(
    patched,
    'clear cues before uploaded subtitle selection',
    "  const selectUploadedSubtitle = () => {\n    const selection: SubtitleSelection = { kind: 'upload' };",
    "  const selectUploadedSubtitle = () => {\n    clearHlsSubtitleCues();\n    const selection: SubtitleSelection = { kind: 'upload' };",
  );

  patched = replaceRequired(
    patched,
    'uploaded subtitle delay hook',
    '            label={subtitleLabel || \'Uploaded subtitles\'}\n          />',
    [
      "            label={subtitleLabel || 'Uploaded subtitles'}",
      '            data-uhd-uploaded-subtitle="true"',
      '            onLoad={() => applyUploadedSubtitleDelay()}',
      '          />',
    ].join('\n'),
  );

  return patched;
}

module.exports = {
  patchStreamStabilityPlayer,
  patchStreamStabilityRoute,
};
