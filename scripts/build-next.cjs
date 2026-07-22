const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const playerPath = path.join(root, 'src', 'components', 'EnhancedVideoPlayer.tsx');
const original = fs.readFileSync(playerPath, 'utf8');

const nullNarrowingPattern = /  const activeGooglePlaybackMode: GooglePlaybackMode =\r?\n    googlePlaybackOverride\?\.sourceUrl === activePlaybackSource\?\.url\r?\n      \? googlePlaybackOverride\.mode\r?\n      : 'direct';/;

const correctedBlock = [
  '  const activeGooglePlaybackMode: GooglePlaybackMode =',
  '    googlePlaybackOverride &&',
  '    googlePlaybackOverride.sourceUrl === activePlaybackSource?.url',
  '      ? googlePlaybackOverride.mode',
  "      : 'direct';",
].join('\n');

const alreadyCorrected = original.includes(correctedBlock);
const patched = alreadyCorrected
  ? original
  : original.replace(nullNarrowingPattern, correctedBlock);

if (!alreadyCorrected && patched === original) {
  console.error('Could not locate the expected player null-narrowing block.');
  process.exit(1);
}

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
