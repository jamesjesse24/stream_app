import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProviderName = 'opensubtitles' | 'subdl';

interface SubtitleResult {
  id: string;
  provider: ProviderName;
  providerLabel: string;
  language: string;
  release: string;
  fileName: string;
  hearingImpaired: boolean;
  downloads: number;
  fps: number | null;
}

interface ProviderStatus {
  provider: ProviderName;
  configured: boolean;
  ok: boolean;
  message?: string;
}

const USER_AGENT =
  process.env.OPENSUBTITLES_USER_AGENT?.trim() || 'UHDMovies/0.1.0';
const MAX_RESULTS_PER_PROVIDER = 20;
const FETCH_TIMEOUT_MS = 20_000;

function cleanValue(value: string | null, maxLength: number): string {
  return (value ?? '').trim().slice(0, maxLength);
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLanguages(value: string): string {
  const normalized = value
    .split(',')
    .map((language) => language.trim().toLowerCase())
    .filter((language) => /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language));
  return normalized.length > 0 ? normalized.slice(0, 5).join(',') : 'en';
}

function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createSubdlToken(payload: { url: string; name: string }): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

async function fetchJson(url: URL, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 500) };
    }

    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && 'message' in body
          ? String((body as { message?: unknown }).message ?? '')
          : response.statusText;
      throw new Error(`${response.status} ${detail || response.statusText}`.trim());
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchOpenSubtitles(options: {
  query: string;
  languages: string;
  season: number | null;
  episode: number | null;
}): Promise<SubtitleResult[]> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY?.trim();
  if (!apiKey) return [];

  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  url.searchParams.set('query', options.query);
  url.searchParams.set('languages', options.languages);
  url.searchParams.set('order_by', 'download_count');
  url.searchParams.set('order_direction', 'desc');
  if (options.season) url.searchParams.set('season_number', String(options.season));
  if (options.episode) url.searchParams.set('episode_number', String(options.episode));
  if (options.episode) url.searchParams.set('type', 'episode');

  const body = (await fetchJson(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Api-Key': apiKey,
      'User-Agent': USER_AGENT,
    },
  })) as { data?: Array<Record<string, unknown>> };

  const results: SubtitleResult[] = [];
  for (const item of body.data ?? []) {
    const attributes =
      item.attributes && typeof item.attributes === 'object'
        ? (item.attributes as Record<string, unknown>)
        : {};
    const files = Array.isArray(attributes.files)
      ? (attributes.files as Array<Record<string, unknown>>)
      : [];

    for (const file of files) {
      const fileId = safeNumber(file.file_id);
      if (!(fileId > 0)) continue;
      const fileName = safeText(file.file_name, `subtitle-${fileId}.srt`);
      results.push({
        id: String(fileId),
        provider: 'opensubtitles',
        providerLabel: 'OpenSubtitles',
        language: safeText(attributes.language, 'und'),
        release: safeText(attributes.release, fileName),
        fileName,
        hearingImpaired: Boolean(attributes.hearing_impaired),
        downloads: safeNumber(attributes.download_count),
        fps: safeNumber(attributes.fps) || null,
      });
      if (results.length >= MAX_RESULTS_PER_PROVIDER) return results;
    }
  }
  return results;
}

async function searchSubdl(options: {
  query: string;
  languages: string;
  season: number | null;
  episode: number | null;
  fileName: string;
}): Promise<SubtitleResult[]> {
  const apiKey = process.env.SUBDL_API_KEY?.trim();
  if (!apiKey) return [];

  const url = new URL('https://api.subdl.com/api/v2/subtitles/search');
  if (options.fileName) url.searchParams.set('file_name', options.fileName);
  else url.searchParams.set('film_name', options.query);
  url.searchParams.set('languages', options.languages);
  url.searchParams.set('unpack', '1');
  if (options.episode) url.searchParams.set('type', 'tv');
  if (options.season) url.searchParams.set('season', String(options.season));
  if (options.episode) url.searchParams.set('episode', String(options.episode));

  const body = (await fetchJson(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
    },
  })) as {
    subtitles?: Array<Record<string, unknown>>;
    data?: Array<Record<string, unknown>>;
  };

  const subtitles = Array.isArray(body.subtitles)
    ? body.subtitles
    : Array.isArray(body.data)
      ? body.data
      : [];
  const results: SubtitleResult[] = [];

  for (const subtitle of subtitles) {
    const unpackFiles = Array.isArray(subtitle.unpack_files)
      ? (subtitle.unpack_files as Array<Record<string, unknown>>)
      : [];
    const candidates = unpackFiles.length > 0 ? unpackFiles : [subtitle];

    for (const file of candidates) {
      const rawUrl = safeText(file.url || subtitle.url);
      if (!rawUrl) continue;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl, 'https://dl.subdl.com');
      } catch {
        continue;
      }
      if (
        parsedUrl.protocol !== 'https:' ||
        !['dl.subdl.com', 'subdl.com'].includes(parsedUrl.hostname.toLowerCase())
      ) {
        continue;
      }

      const fileName = safeText(
        file.name || file.file_name || subtitle.name,
        'subtitle.srt',
      );
      const release = safeText(
        file.release_name || subtitle.release_name,
        fileName,
      );
      const format = safeText(file.format || subtitle.format).toLowerCase();
      if (format && !['srt', 'vtt', 'webvtt'].includes(format)) continue;

      results.push({
        id: createSubdlToken({ url: parsedUrl.toString(), name: fileName }),
        provider: 'subdl',
        providerLabel: 'SubDL',
        language: safeText(file.language || subtitle.language, 'und').toLowerCase(),
        release,
        fileName,
        hearingImpaired: Boolean(file.hi ?? subtitle.hi),
        downloads: safeNumber(subtitle.download_count || subtitle.downloads),
        fps: safeNumber(file.fps || subtitle.fps) || null,
      });
      if (results.length >= MAX_RESULTS_PER_PROVIDER) return results;
    }
  }
  return results;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = cleanValue(request.nextUrl.searchParams.get('query'), 180);
  const fileName = cleanValue(request.nextUrl.searchParams.get('fileName'), 260);
  const languages = normalizeLanguages(
    cleanValue(request.nextUrl.searchParams.get('languages'), 80) || 'en',
  );
  const season = parsePositiveInteger(request.nextUrl.searchParams.get('season'));
  const episode = parsePositiveInteger(request.nextUrl.searchParams.get('episode'));

  if (query.length < 2 && fileName.length < 2) {
    return NextResponse.json(
      { error: 'Provide a title or release file name containing at least two characters.' },
      { status: 400 },
    );
  }

  const statuses: ProviderStatus[] = [];
  const tasks: Array<Promise<SubtitleResult[]>> = [];

  const openSubtitlesConfigured = Boolean(process.env.OPENSUBTITLES_API_KEY?.trim());
  statuses.push({
    provider: 'opensubtitles',
    configured: openSubtitlesConfigured,
    ok: openSubtitlesConfigured,
    message: openSubtitlesConfigured ? undefined : 'OPENSUBTITLES_API_KEY is not configured',
  });
  if (openSubtitlesConfigured) {
    tasks.push(
      searchOpenSubtitles({ query: query || fileName, languages, season, episode }).catch(
        (error) => {
          const status = statuses.find((entry) => entry.provider === 'opensubtitles');
          if (status) {
            status.ok = false;
            status.message = error instanceof Error ? error.message : String(error);
          }
          return [];
        },
      ),
    );
  }

  const subdlConfigured = Boolean(process.env.SUBDL_API_KEY?.trim());
  statuses.push({
    provider: 'subdl',
    configured: subdlConfigured,
    ok: subdlConfigured,
    message: subdlConfigured ? undefined : 'SUBDL_API_KEY is not configured',
  });
  if (subdlConfigured) {
    tasks.push(
      searchSubdl({ query: query || fileName, fileName, languages, season, episode }).catch(
        (error) => {
          const status = statuses.find((entry) => entry.provider === 'subdl');
          if (status) {
            status.ok = false;
            status.message = error instanceof Error ? error.message : String(error);
          }
          return [];
        },
      ),
    );
  }

  const providerResults = await Promise.all(tasks);
  const deduped = new Map<string, SubtitleResult>();
  for (const result of providerResults.flat()) {
    const key = `${result.provider}|${result.language}|${result.fileName.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || result.downloads > existing.downloads) deduped.set(key, result);
  }

  const results = Array.from(deduped.values())
    .sort((left, right) => right.downloads - left.downloads)
    .slice(0, 40);

  return NextResponse.json(
    {
      query: query || fileName,
      languages,
      season,
      episode,
      results,
      providers: statuses,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  );
}
