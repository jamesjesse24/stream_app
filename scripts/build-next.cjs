const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const playerPath = path.join(root, 'src', 'components', 'EnhancedVideoPlayer.tsx');
const original = fs.readFileSync(playerPath, 'utf8');

function applyRequiredPatch(source, { name, pattern, replacement }) {
  if (source.includes(replacement)) return source;

  const patched = source.replace(pattern, replacement);
  if (patched === source) {
    console.error(`Could not locate the expected ${name} block.`);
    process.exit(1);
  }
  return patched;
}

const nullNarrowingPattern = /  const activeGooglePlaybackMode: GooglePlaybackMode =\r?\n    googlePlaybackOverride\?\.sourceUrl === activePlaybackSource\?\.url\r?\n      \? googlePlaybackOverride\.mode\r?\n      : 'direct';/;

const correctedNullNarrowingBlock = [
  '  const activeGooglePlaybackMode: GooglePlaybackMode =',
  '    googlePlaybackOverride &&',
  '    googlePlaybackOverride.sourceUrl === activePlaybackSource?.url',
  '      ? googlePlaybackOverride.mode',
  "      : 'remux';",
].join('\n');

const autoplayPattern = /    const tryAutoPlay = async \(\) => \{\r?\n      if \(autoplayAttempted \|\| \(!autoPlay && !shouldResumePlayingRef\.current\)\) return;\r?\n      autoplayAttempted = true;\r?\n      try \{\r?\n        await video\.play\(\);\r?\n      \} catch \(error\) \{\r?\n        if \(\(error as DOMException\)\?\.name !== 'NotAllowedError'\) \{\r?\n          console\.warn\('Playback could not start automatically:', error\);\r?\n        \}\r?\n        setIsPlaying\(false\);\r?\n      \}\r?\n    \};/;

const correctedAutoplayBlock = [
  '    const tryAutoPlay = async () => {',
  '      if (autoplayAttempted || (!autoPlay && !shouldResumePlayingRef.current)) return;',
  '      autoplayAttempted = true;',
  '      try {',
  '        await video.play();',
  '      } catch (error) {',
  '        const mediaError = error as DOMException;',
  "        if (mediaError?.name === 'NotAllowedError' && !video.muted) {",
  '          // Browsers commonly block autoplay with audio after navigation.',
  '          // Retry muted so playback starts immediately; the user can unmute',
  '          // from the existing volume control without reloading the stream.',
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

let patched = original;
patched = applyRequiredPatch(patched, {
  name: 'player null-narrowing and Google MKV remux default',
  pattern: nullNarrowingPattern,
  replacement: correctedNullNarrowingBlock,
});
patched = applyRequiredPatch(patched, {
  name: 'autoplay fallback',
  pattern: autoplayPattern,
  replacement: correctedAutoplayBlock,
});

let exitCode = 1;

try {
  if (patched !== original) {
    fs.writeFileSync(playerPath, patched, 'utf8');
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
  if (patched !== original) {
    fs.writeFileSync(playerPath, original, 'utf8');
  }
}

process.exit(exitCode);
