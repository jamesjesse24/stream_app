import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_PROCESS_OUTPUT = 1024 * 1024;

class DiagnosticError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DiagnosticError';
  }
}

function parseTrustedSource(value: string | null): URL {
  if (!value) throw new DiagnosticError(400, 'Missing url parameter');

  let source: URL;
  try {
    source = new URL(value);
  } catch {
    throw new DiagnosticError(400, 'Invalid source URL');
  }

  if (source.protocol !== 'https:') {
    throw new DiagnosticError(400, 'Only HTTPS sources are supported');
  }

  const hostname = source.hostname.toLowerCase();
  const trusted =
    hostname === 'video-downloads.googleusercontent.com' ||
    hostname.endsWith('.video-downloads.googleusercontent.com') ||
    hostname === 'cdn.video-plex.xyz';
  if (!trusted) throw new DiagnosticError(403, 'Source host is not trusted');

  return source;
}

function responseHeaders(response: Response): Record<string, string | null> {
  return {
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    contentRange: response.headers.get('content-range'),
    acceptRanges: response.headers.get('accept-ranges'),
    contentDisposition: response.headers.get('content-disposition'),
    server: response.headers.get('server'),
  };
}

async function runFfprobe(sourceUrl: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const args = [
      '-v',
      'error',
      '-rw_timeout',
      '60000000',
      '-user_agent',
      USER_AGENT,
      '-show_entries',
      'format=format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,channels,sample_rate',
      '-of',
      'json',
      sourceUrl,
    ];
    const child = spawn('ffprobe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'ffprobe timed out after 60 seconds' });
    }, 60_000);

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_PROCESS_OUTPUT) stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_PROCESS_OUTPUT) stderr += String(chunk);
    });
    child.once('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        error: error.message,
        hint: 'Install FFmpeg and ensure ffprobe.exe is available on PATH.',
      });
    });
    child.once('exit', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          code,
          signal,
          stderr: stderr.trim().slice(-8000),
        });
        return;
      }
      try {
        resolve({ ok: true, result: JSON.parse(stdout) });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          stdout: stdout.slice(0, 8000),
          stderr: stderr.slice(-8000),
        });
      }
    });
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.STREAM_DEBUG !== '1') {
    return NextResponse.json({ error: 'Stream diagnostics are disabled' }, { status: 404 });
  }

  try {
    const source = parseTrustedSource(request.nextUrl.searchParams.get('url'));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const startedAt = Date.now();

    let rangeResult: Record<string, unknown>;
    try {
      const response = await fetch(source, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Range: 'bytes=0-15',
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'identity',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      rangeResult = {
        status: response.status,
        finalHost: new URL(response.url).hostname,
        elapsedMs: Date.now() - startedAt,
        headers: responseHeaders(response),
        bodyLength: body.byteLength,
        firstBytesHex: Array.from(body.slice(0, 16))
          .map((value) => value.toString(16).padStart(2, '0'))
          .join(' '),
        reliableRange:
          response.status === 206 &&
          /^bytes\s+0-15\/\d+$/i.test(response.headers.get('content-range') || '') &&
          body.byteLength === 16,
      };
    } finally {
      clearTimeout(timeout);
    }

    const ffprobe = await runFfprobe(source.toString());
    const result = {
      source: {
        host: source.hostname,
        pathLength: source.pathname.length,
      },
      range: rangeResult,
      ffprobe,
    };

    console.log('[stream-debug][diagnose]', JSON.stringify(result, null, 2));
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof DiagnosticError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error('[stream-debug][diagnose] failed:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
