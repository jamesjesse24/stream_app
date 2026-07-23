function replaceRequired(source, name, original, replacement) {
  if (source.includes(replacement)) return source;
  const patched = source.replace(original, replacement);
  if (patched === source) {
    throw new Error(`Could not locate the expected ${name} block.`);
  }
  return patched;
}

function patchStreamLifecycleRoute(source) {
  if (
    source.includes('async function handleClientAction(') &&
    source.includes('clientTrackingEnabled: boolean;')
  ) {
    return source;
  }

  let patched = source;

  patched = replaceRequired(
    patched,
    'viewer lease constants',
    [
      'const SESSION_IDLE_MS = 20 * 60 * 1000;',
      'const CLEANUP_INTERVAL_MS = 60 * 1000;',
    ].join('\n'),
    [
      'const SESSION_IDLE_MS = 20 * 60 * 1000;',
      'const CLIENT_STALE_MS = 120 * 1000;',
      'const CLIENT_RELEASE_GRACE_MS = 3 * 1000;',
      'const CLEANUP_INTERVAL_MS = 2 * 1000;',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'viewer identifier pattern',
    "const SESSION_PATTERN = /^[a-f0-9]{32}$/;",
    [
      "const SESSION_PATTERN = /^[a-f0-9]{32}$/;",
      "const CLIENT_PATTERN = /^[A-Za-z0-9_-]{12,96}$/;",
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'viewer lease session fields',
    [
      '  generatedSeconds: number;',
      '  mediaIdentity: string | null;',
      '  subtitleTrack: SubtitleTrack | null;',
    ].join('\n'),
    [
      '  generatedSeconds: number;',
      '  mediaIdentity: string | null;',
      '  clients: Map<string, number>;',
      '  clientTrackingEnabled: boolean;',
      '  emptySince: number | null;',
      '  subtitleTrack: SubtitleTrack | null;',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'viewer action dispatch',
    [
      "  const sessionId = request.nextUrl.searchParams.get('session');",
      "  const asset = request.nextUrl.searchParams.get('asset');",
      '',
      '  try {',
      '    if (sessionId !== null || asset !== null) {',
    ].join('\n'),
    [
      "  const sessionId = request.nextUrl.searchParams.get('session');",
      "  const asset = request.nextUrl.searchParams.get('asset');",
      "  const action = request.nextUrl.searchParams.get('action');",
      '',
      '  try {',
      '    if (action !== null) return await handleClientAction(request, action);',
      '    if (sessionId !== null || asset !== null) {',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'viewer registration on session creation',
    [
      '    const sourceUrl = validateSourceUrl(sourceValue);',
      "    const transcode = transcodeValue === '1';",
      '    const session = await getOrCreateSession(sourceUrl, transcode);',
      '    session.lastAccess = Date.now();',
    ].join('\n'),
    [
      '    const sourceUrl = validateSourceUrl(sourceValue);',
      "    const transcode = transcodeValue === '1';",
      '    const clientId = parseClientId(',
      "      request.nextUrl.searchParams.get('client'),",
      '      false,',
      '    );',
      '    const session = await getOrCreateSession(sourceUrl, transcode);',
      '    if (clientId) touchClient(session, clientId);',
      '    else session.lastAccess = Date.now();',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'viewer lease session initialization',
    [
      '    generatedSeconds: 0,',
      '    mediaIdentity: null,',
      '    subtitleTrack: null,',
    ].join('\n'),
    [
      '    generatedSeconds: 0,',
      '    mediaIdentity: null,',
      '    clients: new Map<string, number>(),',
      '    clientTrackingEnabled: false,',
      '    emptySince: null,',
      '    subtitleTrack: null,',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'shared linear session identity',
    [
      "  const key = `linear-v2\\0${transcode ? 'transcode' : 'copy'}\\0${sourceUrl}`;",
      "  const id = createHash('sha256').update(key).digest('hex').slice(0, 32);",
    ].join('\n'),
    '  const { key, id } = linearSessionIdentity(sourceUrl, transcode);',
  );

  patched = replaceRequired(
    patched,
    'viewer lease helpers',
    'async function serveAsset(\n',
    `export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}

async function handleClientAction(
  request: NextRequest,
  action: string,
): Promise<NextResponse> {
  if (action !== 'heartbeat' && action !== 'release') {
    throw new HttpError(400, 'Unsupported viewer action');
  }

  const sourceValue = request.nextUrl.searchParams.get('url');
  if (!sourceValue) throw new HttpError(400, 'Missing url parameter');
  const transcodeValue = request.nextUrl.searchParams.get('transcode');
  if (transcodeValue !== null && transcodeValue !== '0' && transcodeValue !== '1') {
    throw new HttpError(400, 'transcode must be either 0 or 1');
  }

  const clientId = parseClientId(request.nextUrl.searchParams.get('client'), true)!;
  const sourceUrl = validateSourceUrl(sourceValue);
  const transcode = transcodeValue === '1';
  const { id } = linearSessionIdentity(sourceUrl, transcode);
  const session = store.sessions.get(id);
  if (!session) return new NextResponse(null, { status: 204 });

  if (action === 'heartbeat') {
    touchClient(session, clientId);
  } else {
    session.clients.delete(clientId);
    session.lastAccess = Date.now();
    if (session.clientTrackingEnabled && session.clients.size === 0) {
      session.emptySince = Date.now();
    }
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'X-Linear-Session': session.id,
      'X-Linear-Viewers': String(session.clients.size),
    },
  });
}

function parseClientId(value: string | null, required: boolean): string | null {
  if (!value) {
    if (required) throw new HttpError(400, 'Missing viewer identifier');
    return null;
  }
  if (!CLIENT_PATTERN.test(value)) {
    throw new HttpError(400, 'Invalid viewer identifier');
  }
  return value;
}

function linearSessionIdentity(
  sourceUrl: string,
  transcode: boolean,
): { key: string; id: string } {
  const key = \`linear-v2\\0\${transcode ? 'transcode' : 'copy'}\\0\${sourceUrl}\`;
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return { key, id };
}

function touchClient(session: LinearSession, clientId: string): void {
  const now = Date.now();
  session.clientTrackingEnabled = true;
  session.clients.set(clientId, now);
  session.emptySince = null;
  session.lastAccess = now;
}

async function serveAsset(
`,
  );

  patched = replaceRequired(
    patched,
    'viewer-aware idle cleanup',
    [
      'async function cleanupIdleSessions(): Promise<void> {',
      '  const now = Date.now();',
      '  const expired = Array.from(store.sessions.values()).filter(',
      '    (session) => now - session.lastAccess > SESSION_IDLE_MS,',
      '  );',
      '  await Promise.all(expired.map((session) => cleanupSession(session)));',
      '}',
    ].join('\n'),
    [
      'async function cleanupIdleSessions(): Promise<void> {',
      '  const now = Date.now();',
      '  const expired: LinearSession[] = [];',
      '',
      '  for (const session of store.sessions.values()) {',
      '    for (const [clientId, lastSeen] of session.clients) {',
      '      if (now - lastSeen > CLIENT_STALE_MS) session.clients.delete(clientId);',
      '    }',
      '',
      '    if (session.clientTrackingEnabled && session.clients.size === 0) {',
      '      session.emptySince ??= now;',
      '      if (now - session.emptySince >= CLIENT_RELEASE_GRACE_MS) {',
      '        expired.push(session);',
      '      }',
      '      continue;',
      '    }',
      '',
      '    session.emptySince = null;',
      '    if (now - session.lastAccess > SESSION_IDLE_MS) expired.push(session);',
      '  }',
      '',
      '  await Promise.all(expired.map((session) => cleanupSession(session)));',
      '}',
    ].join('\n'),
  );

  return patched;
}

function patchStreamLifecyclePlayer(source) {
  if (
    source.includes('playbackClientIdRef') &&
    source.includes("action: 'heartbeat'") &&
    source.includes("window.addEventListener('pagehide'")
  ) {
    return source;
  }

  let patched = source;

  patched = replaceRequired(
    patched,
    'viewer identifier helper',
    'function srtToVtt(value: string): string {',
    `function createPlaybackClientId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.replace(/-/g, '');
  return \`viewer_\${Date.now().toString(36)}_\${Math.random().toString(36).slice(2)}\`;
}

function srtToVtt(value: string): string {`,
  );

  patched = replaceRequired(
    patched,
    'viewer identifier ref',
    '  const subtitleObjectUrlRef = useRef<string | null>(null);',
    [
      '  const subtitleObjectUrlRef = useRef<string | null>(null);',
      '  const playbackClientIdRef = useRef<string>(createPlaybackClientId());',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'leased playback target',
    [
      '  const activePlaybackTarget = useMemo<PlaybackTarget | null>(',
      '    () =>',
      '      activePlaybackSource',
      '        ? getPlaybackUrl(activePlaybackSource, activeGooglePlaybackMode)',
      '        : null,',
      '    [activeGooglePlaybackMode, activePlaybackSource],',
      '  );',
    ].join('\n'),
    [
      '  const activePlaybackTarget = useMemo<PlaybackTarget | null>(() => {',
      '    if (!activePlaybackSource) return null;',
      '    const target = getPlaybackUrl(activePlaybackSource, activeGooglePlaybackMode);',
      "    if (!target.url.startsWith('/api/playback-linear?')) return target;",
      '',
      "    const query = target.url.slice(target.url.indexOf('?') + 1);",
      '    const params = new URLSearchParams(query);',
      "    params.set('client', playbackClientIdRef.current);",
      '    return {',
      '      ...target,',
      '      url: `/api/playback-linear?${params.toString()}`,',
      '    };',
      '  }, [activeGooglePlaybackMode, activePlaybackSource]);',
    ].join('\n'),
  );

  patched = replaceRequired(
    patched,
    'viewer heartbeat lifecycle',
    "  const subtitlesEnabled = subtitleSelection.kind !== 'off';\n",
    `  const subtitlesEnabled = subtitleSelection.kind !== 'off';

  useEffect(() => {
    const target = activePlaybackTarget;
    if (!target?.url.startsWith('/api/playback-linear?')) return;

    const actionUrl = (action: 'heartbeat' | 'release'): string => {
      const url = new URL(target.url, window.location.origin);
      url.searchParams.set('action', action);
      return url.toString();
    };

    let released = false;
    const heartbeat = () => {
      if (released) return;
      void fetch(actionUrl('heartbeat'), {
        method: 'POST',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => undefined);
    };
    const release = () => {
      if (released) return;
      released = true;
      const url = actionUrl('release');
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
      } else {
        void fetch(url, {
          method: 'POST',
          cache: 'no-store',
          keepalive: true,
        }).catch(() => undefined);
      }
    };

    heartbeat();
    const timer = window.setInterval(heartbeat, 10_000);
    window.addEventListener('pagehide', release, { capture: true });
    window.addEventListener('beforeunload', release, { capture: true });

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', release, { capture: true });
      window.removeEventListener('beforeunload', release, { capture: true });
      release();
    };
  }, [activePlaybackTarget?.url]);
`,
  );

  return patched;
}

module.exports = {
  patchStreamLifecyclePlayer,
  patchStreamLifecycleRoute,
};
