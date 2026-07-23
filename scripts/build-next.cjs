const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  patchLinearTimelinePlayer,
  patchLinearTimelineRoute,
} = require('./patch-linear-timeline.cjs');

const root = path.resolve(__dirname, '..');
const playerPath = path.join(root, 'src', 'components', 'EnhancedVideoPlayer.tsx');
const linearRoutePath = path.join(root, 'app', 'api', 'playback-linear', 'route.ts');
const originalPlayer = fs.readFileSync(playerPath, 'utf8');
const originalLinearRoute = fs.readFileSync(linearRoutePath, 'utf8');

function replaceRequired(source, name, pattern, replacement) {
  if (source.includes(replacement)) return source;
  const patched = source.replace(pattern, replacement);
  if (patched === source) {
    console.error(`Could not locate the expected ${name} block.`);
    process.exit(1);
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

patchedPlayer = patchLinearTimelinePlayer(patchedPlayer);

let patchedLinearRoute = originalLinearRoute
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
patchedLinearRoute = patchLinearTimelineRoute(patchedLinearRoute);

let exitCode = 1;

try {
  if (patchedPlayer !== originalPlayer) fs.writeFileSync(playerPath, patchedPlayer, 'utf8');
  if (patchedLinearRoute !== originalLinearRoute) {
    fs.writeFileSync(linearRoutePath, patchedLinearRoute, 'utf8');
  }

  const nextBin = require.resolve('next/dist/bin/next');
  const result = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  exitCode = typeof result.status === 'number' ? result.status : 1;
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  if (patchedPlayer !== originalPlayer) fs.writeFileSync(playerPath, originalPlayer, 'utf8');
  if (patchedLinearRoute !== originalLinearRoute) {
    fs.writeFileSync(linearRoutePath, originalLinearRoute, 'utf8');
  }
}

process.exit(exitCode);
