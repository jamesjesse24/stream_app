import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 12_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface ProbeResult {
  contentLength: number | null;
  contentType: string | null;
  isHls: boolean;
  source: 'content-length' | 'content-range' | null;
}

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get('url');
  if (!value) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const sourceUrl = await validatePublicMediaUrl(value);
    const result = await probeMedia(sourceUrl);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to inspect media';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function validatePublicMediaUrl(value: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Media URL must be an absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS media URLs are supported');
  }
  if (url.username || url.password) {
    throw new Error('Media URLs containing credentials are not supported');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Local media URLs cannot be inspected');
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Private-network media URLs cannot be inspected');
  }

  return url.toString();
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  const ipv4 = normalized.startsWith('::ffff:')
    ? normalized.slice('::ffff:'.length)
    : normalized;
  const parts = ipv4.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function probeMedia(sourceUrl: string): Promise<ProbeResult> {
  const urlLooksLikeHls = /\.m3u8(?:$|[?#])/i.test(sourceUrl);
  const headResult = await probeWithHead(sourceUrl).catch(() => null);
  if (headResult) {
    const isHls = urlLooksLikeHls || isHlsContentType(headResult.contentType);
    if (isHls) {
      return {
        contentLength: null,
        contentType: headResult.contentType,
        isHls: true,
        source: null,
      };
    }
    if (headResult.contentLength !== null) {
      return { ...headResult, isHls: false, source: 'content-length' };
    }
  }

  const rangeResult = await probeWithRange(sourceUrl);
  const isHls = urlLooksLikeHls || isHlsContentType(rangeResult.contentType);
  if (isHls) {
    return {
      contentLength: null,
      contentType: rangeResult.contentType,
      isHls: true,
      source: null,
    };
  }

  return { ...rangeResult, isHls: false };
}

async function probeWithHead(sourceUrl: string): Promise<Omit<ProbeResult, 'isHls' | 'source'>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      method: 'HEAD',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'identity',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HEAD request returned ${response.status}`);

    return {
      contentLength: parsePositiveInteger(response.headers.get('content-length')),
      contentType: response.headers.get('content-type'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeWithRange(sourceUrl: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        Range: 'bytes=0-0',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'identity',
      },
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type');
    const contentRange = response.headers.get('content-range');
    const rangeMatch = contentRange?.match(/\/([0-9]+)\s*$/);
    const rangeLength = parsePositiveInteger(rangeMatch?.[1] ?? null);
    const headerLength = parsePositiveInteger(response.headers.get('content-length'));
    await response.body?.cancel().catch(() => undefined);

    if (!response.ok) throw new Error(`Range request returned ${response.status}`);
    return {
      contentLength: rangeLength ?? headerLength,
      contentType,
      isHls: false,
      source: rangeLength !== null ? 'content-range' : headerLength !== null ? 'content-length' : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isHlsContentType(contentType: string | null): boolean {
  return Boolean(
    contentType &&
      /(?:application|audio)\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(contentType),
  );
}
