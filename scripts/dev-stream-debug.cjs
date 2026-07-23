const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = process.cwd();
const playerPath = path.join(root, 'src', 'components', 'EnhancedVideoPlayer.tsx');
const linearRoutePath = path.join(root, 'app', 'api', 'playback-linear', 'route.ts');
const originalPlayer = fs.readFileSync(playerPath, 'utf8');
const originalLinearRoute = fs.readFileSync(linearRoutePath, 'utf8');

function replaceRequired(source, name, pattern, replacement) {
  if (source.includes(replacement)) return source;
  const patched = source.replace(pattern, replacement);
  if (patched === source) {
    throw new Error(`Could not locate the expected ${name} block.`);
  }
  return patched;
}

let patchedPlayer = originalPlayer;

const originalModePattern = /  const activeGooglePlaybackMode: GooglePlaybackMode =\r?\n    googlePlaybackOverride\?\.sourceUrl === activePlaybackSource\?\.url\r?\n      \? googlePlaybackOverride\.mode\r?\n      : 'direct';/;
const directModePattern = /  const activeGooglePlaybackMode: GooglePlaybackMode =\r?\n    googlePlaybackOverride &&\r?\n    googlePlaybackOverride\.sourceUrl === activePlaybackSource\?\.url\r?\n      \? googlePlaybackOverride\.mode\r?\n      : 'direct';/;
const remuxModeBlock = [
  '  const activeGooglePlaybackMode: GooglePlaybackMode =',
  '    googlePlaybackOverride &&',
  '    googlePlaybackOverride.sourceUrl === activePlaybackSource?.url',
  '      ? googlePlaybackOverride.mode',
  "      : 'remux';",
].join('\n');

if (!patchedPlayer.includes(remuxModeBlock)) {
  if (originalModePattern.test(patchedPlayer)) {
    patchedPlayer = patchedPlayer.replace(originalModePattern, remuxModeBlock);
  } else {
    patchedPlayer = replaceRequired(
      patchedPlayer,
      'Google default playback mode',
      directModePattern,
      remuxModeBlock,
    );
  }
}

patchedPlayer = replaceRequired(
  patchedPlayer,
  'Google sequential playback route',
  /url: `\/api\/playback-vod\?\$\{params\.toString\(\)\}`,/,
  'url: `/api/playback-linear?${params.toString()}`,'
);

const autoplayPattern = /    const tryAutoPlay = async \(\) => \{\r?\n      if \(autoplayAttempted \|\| \(!autoPlay && !shouldResumePlayingRef\.current\)\) return;\r?\n      autoplayAttempted = true;\r?\n      try \{\r?\n        await video\.play\(\);\r?\n      \} catch \(error\) \{\r?\n        if \(\(error as DOMException\)\?\.name !== 'NotAllowedError'\) \{\r?\n          console\.warn\('Playback could not start automatically:', error\);\r?\n        \}\r?\n        setIsPlaying\(false\);\r?\n      \}\r?\n    \};/;
const autoplayReplacement = [
  '    const tryAutoPlay = async () => {',
  '      if (autoplayAttempted || (!autoPlay && !shouldResumePlayingRef.current)) return;',
  '      autoplayAttempted = true;',
  '      try {',
  '        await video.play();',
  '      } catch (error) {',
  '        const mediaError = error as DOMException;',
  "        if (mediaError?.name === 'NotAllowedError' && !video.muted) {",
  '          video.muted = true;',
  '          setIsMuted(true);',
  '          try {',
  '            await video.play();',
  '            return;',
  '          } catch (mutedError) {',
  "            console.warn('Muted autoplay could not start:', mutedError);",
  '          }',
  "        } else if (mediaError?.name !== 'NotAllowedError') {",
  "          console.warn('Playback could not start automatically:', error);",
  '        }',
  '        setIsPlaying(false);',
  '      }',
  '    };',
].join('\n');

if (!patchedPlayer.includes(autoplayReplacement)) {
  patchedPlayer = replaceRequired(
    patchedPlayer,
    'muted autoplay fallback',
    autoplayPattern,
    autoplayReplacement,
  );
}

const patchedLinearRoute = originalLinearRoute
  .replace(
    "import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';",
    "import { spawn, type ChildProcess } from 'child_process';",
  )
  .replace(
    'process: ChildProcessWithoutNullStreams | null;',
    'process: ChildProcess | null;',
  )
  .replace(
    "response.body as unknown as import('stream/web').ReadableStream<Uint8Array>",
    'response.body as any',
  );

fs.writeFileSync(playerPath, patchedPlayer, 'utf8');
fs.writeFileSync(linearRoutePath, patchedLinearRoute, 'utf8');

const nextBin = require.resolve('next/dist/bin/next');
const args = [nextBin, 'dev', ...process.argv.slice(2)];
const env = {
  ...process.env,
  STREAM_DEBUG: '1',
  NEXT_PUBLIC_STREAM_DEBUG: '1',
};

console.log('[stream-debug] Development diagnostics enabled.');
console.log('[stream-debug] Google MKV playback uses sequential HLS without HTTP byte ranges.');
console.log('[stream-debug] Stream requests, API responses, FFmpeg output, media events, and errors will appear here.');

const child = spawn(process.execPath, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: false,
});

let stopping = false;
let restored = false;

function restoreSources() {
  if (restored) return;
  restored = true;
  try {
    fs.writeFileSync(playerPath, originalPlayer, 'utf8');
    fs.writeFileSync(linearRoutePath, originalLinearRoute, 'utf8');
  } catch (error) {
    console.error('[stream-debug] Could not restore patched source files:', error);
  }
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('exit', restoreSources);

child.on('error', (error) => {
  console.error('[stream-debug] Failed to start Next.js:', error);
  restoreSources();
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  restoreSources();
  if (signal) {
    console.log(`[stream-debug] Next.js stopped by ${signal}.`);
    process.exitCode = 0;
    return;
  }
  process.exitCode = code ?? 1;
});
