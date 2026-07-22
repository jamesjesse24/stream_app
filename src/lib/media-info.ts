import type { VideoLink } from '@/types';

export interface MediaInfoResponse {
  contentLength: number | null;
  contentType: string | null;
  isHls: boolean;
  source: 'content-length' | 'content-range' | 'hls-byte-range' | 'hls-estimate' | null;
  estimated?: boolean;
}

export interface SourceMediaInfoState {
  loading: boolean;
  info: MediaInfoResponse | null;
  error?: string;
}

export function decodeMediaUrl(value: string): string {
  // Preserve already-valid signed URLs exactly. Decoding their query values
  // can invalidate provider signatures.
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value;
  } catch {
    // Encoded absolute URLs are handled below.
  }

  let result = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
      const parsed = new URL(result);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return result;
    } catch {
      // Continue only while decoding remains possible.
    }
  }
  return result;
}

export function mediaUrlForSource(source: Pick<VideoLink, 'url' | 'videoUrl'>): string {
  return decodeMediaUrl(source.videoUrl || source.url);
}

export function formatMediaBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  const gibibytes = value / 1024 ** 3;
  if (gibibytes >= 1) return `${gibibytes.toFixed(2)} GB`;
  return `${Math.max(0.01, value / 1024 ** 2).toFixed(2)} MB`;
}

export async function requestMediaInfo(
  source: Pick<VideoLink, 'url' | 'videoUrl'>,
  signal?: AbortSignal,
): Promise<MediaInfoResponse> {
  const mediaUrl = mediaUrlForSource(source);
  const response = await fetch(`/api/media-info?url=${encodeURIComponent(mediaUrl)}`, {
    cache: 'no-store',
    signal,
  });

  const result = (await response.json().catch(() => null)) as
    | (MediaInfoResponse & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(result?.error || `Media information returned ${response.status}`);
  }
  if (!result) throw new Error('Media information response was empty');
  return result;
}

export function mediaInfoSizeLabel(
  state: SourceMediaInfoState | undefined,
  fallbackBytes?: number | null,
  fallbackEstimated = false,
): string {
  const bytes =
    Number.isFinite(fallbackBytes) && (fallbackBytes ?? 0) > 0
      ? fallbackBytes ?? null
      : state?.info?.contentLength ?? null;
  const estimated = fallbackEstimated || Boolean(state?.info?.estimated);

  if (bytes !== null && bytes > 0) {
    return `${estimated ? '~' : ''}${formatMediaBytes(bytes)}`;
  }
  if (state?.loading) return 'Checking…';
  if (state?.info?.isHls) return 'Calculated during playback';
  return 'Unavailable';
}
