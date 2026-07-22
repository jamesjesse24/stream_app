const { spawn } = require('node:child_process');

const nextBin = require.resolve('next/dist/bin/next');
const args = [nextBin, 'dev', ...process.argv.slice(2)];
const env = {
  ...process.env,
  STREAM_DEBUG: '1',
  NEXT_PUBLIC_STREAM_DEBUG: '1',
};

console.log('[stream-debug] Development diagnostics enabled.');
console.log('[stream-debug] Stream requests, API responses, media events, and errors will appear in this terminal.');
console.log('[stream-debug] Reproduce the buffering problem, then copy the lines beginning with [stream-debug].');

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: false,
});

let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

child.on('error', (error) => {
  console.error('[stream-debug] Failed to start Next.js:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[stream-debug] Next.js stopped by ${signal}.`);
    process.exitCode = 0;
    return;
  }
  process.exitCode = code ?? 1;
});
