import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProviderName = 'opensubtitles' | 'subdl';

interface DownloadRequest {
  provider?: ProviderName;
  id?: string;
}

const USER_AGENT =
  process.env.OPENSUBTITLES_USER_AGENT?.trim() || 'UHDMovies/0.1.0';
const FETCH_TIMEOUT_MS = 25_000;
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function srtToVtt(value: string): string {
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r+/g, '');
  if (normalized.trimStart().startsWith('WEBVTT')) return normalized;

  const withoutSequenceNumbers = normalized
    .split('\n')
    .filter((line, index, lines) => {
      if (!/^\d+$/.test(line.trim())) return true;
      const next = lines[index + 1] ?? '';
      return !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(next.trim());
    })
    .join('\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return `WEBVTT\n\n${withoutSequenceNumbers.trim()}\n`;
}

function decodeSubtitle(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const replacementRatio =
    utf8.length > 0 ? (utf8.match(/\uFFFD/g)?.length ?? 0) / utf8.length : 0;
  if (replacementRatio < 0.002) return utf8;

  try {
    return new TextDecoder('windows-1252', { fatal: false }).decode(bytes);
  } catch {
    return utf8;
  }
}

async function fetchWithTimeout(url: string | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timeout.unref?.();

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readSubtitleResponse(response: Response): Promise<string> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new HttpError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      `Subtitle download failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_SUBTITLE_BYTES) {
    throw new HttpError(413, 'Subtitle file is unexpectedly large');
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_SUBTITLE_BYTES) {
    throw new HttpError(502, 'Subtitle provider returned an invalid file');
  }
  return srtToVtt(decodeSubtitle(buffer));
}

async function downloadOpenSubtitles(id: string): Promise<string> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, 'OpenSubtitles is not configured');
  if (!/^\d+$/.test(id)) throw new HttpError(400, 'Invalid OpenSubtitles file id');

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Api-Key': apiKey,
    'User-Agent': USER_AGENT,
  };
  const token = process.env.OPENSUBTITLES_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchWithTimeout(
    'https://api.opensubtitles.com/api/v1/download',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        file_id: Number(id),
        sub_format: 'webvtt',
      }),
    },
  );
  const text = await response.text();
  let body: { link?: unknown; message?: unknown } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    throw new HttpError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      String(body.message || `OpenSubtitles download request failed with HTTP ${response.status}`),
    );
  }

  if (typeof body.link !== 'string') {
    throw new HttpError(502, 'OpenSubtitles did not return a download link');
  }
  const link = new URL(body.link);
  if (
    link.protocol !== 'https:' ||
    ![
      'www.opensubtitles.com',
      'dl.opensubtitles.com',
      'opensubtitles.com',
    ].some(
      (host) => link.hostname === host || link.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new HttpError(502, 'OpenSubtitles returned an untrusted download host');
  }

  const fileResponse = await fetchWithTimeout(link, {
    method: 'GET',
    headers: {
      Accept: 'text/vtt,text/plain,application/x-subrip,*/*;q=0.5',
      'User-Agent': USER_AGENT,
    },
  });
  return readSubtitleResponse(fileResponse);
}

function decodeSubdlToken(id: string): { url: string; name: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid SubDL subtitle id');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new HttpError(400, 'Invalid SubDL subtitle id');
  }
  const candidate = parsed as { url?: unknown; name?: unknown };
  if (typeof candidate.url !== 'string') {
    throw new HttpError(400, 'Invalid SubDL subtitle id');
  }
  return {
    url: candidate.url,
    name: typeof candidate.name === 'string' ? candidate.name : 'subtitle.srt',
  };
}

async function downloadSubdl(id: string): Promise<string> {
  const apiKey = process.env.SUBDL_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, 'SubDL is not configured');

  const token = decodeSubdlToken(id);
  const url = new URL(token.url);
  if (
    url.protocol !== 'https:' ||
    !['dl.subdl.com', 'subdl.com'].includes(url.hostname.toLowerCase()) ||
    !url.pathname.startsWith('/subtitle/')
  ) {
    throw new HttpError(400, 'Untrusted SubDL download URL');
  }

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Accept: 'text/vtt,text/plain,application/x-subrip,*/*;q=0.5',
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
    },
  });
  return readSubtitleResponse(response);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as DownloadRequest;
    const provider = body.provider;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) throw new HttpError(400, 'Missing subtitle id');

    const subtitle =
      provider === 'opensubtitles'
        ? await downloadOpenSubtitles(id)
        : provider === 'subdl'
          ? await downloadSubdl(id)
          : (() => {
              throw new HttpError(400, 'Unsupported subtitle provider');
            })();

    return new NextResponse(subtitle, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'inline; filename="online-subtitle.vtt"',
        'Content-Type': 'text/vtt; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status });
  }
}
