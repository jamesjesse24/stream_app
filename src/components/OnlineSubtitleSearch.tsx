'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, Globe2, Loader2, Search, Trash2 } from 'lucide-react';

interface SubtitleResult {
  id: string;
  provider: 'opensubtitles' | 'subdl';
  providerLabel: string;
  language: string;
  release: string;
  fileName: string;
  hearingImpaired: boolean;
  downloads: number;
  fps: number | null;
}

interface ProviderStatus {
  provider: 'opensubtitles' | 'subdl';
  configured: boolean;
  ok: boolean;
  message?: string;
}

interface SearchResponse {
  results?: SubtitleResult[];
  providers?: ProviderStatus[];
  error?: string;
}

interface WatchContext {
  title: string;
  season: number | null;
  episode: number | null;
}

const HOST_ID = 'online-subtitle-search-host';
const ONLINE_TRACK_ATTRIBUTE = 'data-online-subtitle-track';

const LANGUAGE_OPTIONS = [
  ['en', 'English'],
  ['tl', 'Filipino'],
  ['ja', 'Japanese'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt-br', 'Portuguese (Brazil)'],
  ['id', 'Indonesian'],
  ['ar', 'Arabic'],
  ['ko', 'Korean'],
  ['zh-cn', 'Chinese (Simplified)'],
] as const;

function decodeRepeatedly(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function titleFromSlug(rawSlug: string): string {
  let value = decodeRepeatedly(rawSlug).trim();
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  } catch {
    // Fall back to the decoded route value.
  }

  value = value.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
  value = value.replace(/^(?:download|watch|anime)[-_]+/i, '');
  value = value.replace(/[-_]+/g, ' ');
  value = value.replace(
    /\b(?:season|series)\s*0*\d+\b.*$/i,
    '',
  );
  value = value.replace(/\bs\s*0*\d{1,2}\b.*$/i, '');
  value = value.replace(/\b20\d{2}\b.*$/i, '');
  value = value.replace(
    /\b(?:1080p|720p|480p|2160p|web[- ]?dl|bluray|webrip|x26[45]|h\.?26[45])\b.*$/i,
    '',
  );
  value = value.replace(/\s+/g, ' ').trim();
  return value || 'Anime';
}

function parseWatchContext(pathname: string): WatchContext | null {
  const match = pathname.match(/\/anime\/([^/]+)\/episode\/([^/]+)\/watch/i);
  if (!match) return null;

  const decodedSlug = decodeRepeatedly(match[1]);
  const seasonMatch = decodedSlug.match(/(?:season[-_ ]?|\bs)(\d{1,2})/i);
  const episode = Number.parseInt(match[2], 10);
  return {
    title: titleFromSlug(match[1]),
    season: seasonMatch ? Number.parseInt(seasonMatch[1], 10) : 1,
    episode: Number.isSafeInteger(episode) && episode > 0 ? episode : null,
  };
}

function languageLabel(code: string): string {
  return (
    LANGUAGE_OPTIONS.find(([value]) => value === code.toLowerCase())?.[1] ||
    code.toUpperCase()
  );
}

function formatDownloads(value: number): string {
  if (!(value > 0)) return 'No download count';
  return `${new Intl.NumberFormat().format(value)} downloads`;
}

function removeOnlineTracks(video: HTMLVideoElement | null): void {
  if (!video) return;
  video
    .querySelectorAll<HTMLTrackElement>(`track[${ONLINE_TRACK_ATTRIBUTE}]`)
    .forEach((track) => track.remove());
}

export function OnlineSubtitleSearch() {
  const pathname = usePathname();
  const context = useMemo(() => parseWatchContext(pathname), [pathname]);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState(context?.title ?? '');
  const [language, setLanguage] = useState('en');
  const [results, setResults] = useState<SubtitleResult[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const activeObjectUrlRef = useRef<string | null>(null);
  const selectedVttRef = useRef<{ text: string; label: string; language: string } | null>(
    null,
  );
  const searchedContextRef = useRef<string | null>(null);

  useEffect(() => {
    setQuery(context?.title ?? '');
    setResults([]);
    setProviders([]);
    setError('');
    setSelectedId(null);
    setSelectedLabel('');
    selectedVttRef.current = null;
    searchedContextRef.current = null;
  }, [context?.episode, context?.season, context?.title]);

  const clearOnlineSubtitle = useCallback(() => {
    const video = document.querySelector<HTMLVideoElement>('video[data-testid="media-element"]');
    removeOnlineTracks(video);
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
    selectedVttRef.current = null;
    setSelectedId(null);
    setSelectedLabel('');
  }, []);

  const installOnlineSubtitle = useCallback(
    (text: string, label: string, subtitleLanguage: string) => {
      const video = document.querySelector<HTMLVideoElement>('video[data-testid="media-element"]');
      if (!video) throw new Error('The video player is not available');

      removeOnlineTracks(video);
      if (activeObjectUrlRef.current) URL.revokeObjectURL(activeObjectUrlRef.current);
      const objectUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      activeObjectUrlRef.current = objectUrl;

      for (let index = 0; index < video.textTracks.length; index += 1) {
        video.textTracks[index].mode = 'disabled';
      }

      const track = document.createElement('track');
      track.setAttribute(ONLINE_TRACK_ATTRIBUTE, 'true');
      track.kind = 'subtitles';
      track.label = label;
      track.srclang = subtitleLanguage || 'en';
      track.src = objectUrl;
      track.default = true;
      track.addEventListener(
        'load',
        () => {
          track.track.mode = 'showing';
        },
        { once: true },
      );
      video.appendChild(track);
      track.track.mode = 'showing';
      selectedVttRef.current = { text, label, language: subtitleLanguage };
    },
    [],
  );

  useEffect(() => {
    const attachPortalHost = () => {
      const subtitleOffButton = document.querySelector<HTMLElement>(
        '[data-testid="subtitle-off"]',
      );
      const panel = subtitleOffButton?.parentElement;
      if (!panel) {
        setPortalHost(null);
        return;
      }

      let host = panel.querySelector<HTMLElement>(`#${HOST_ID}`);
      if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.dataset.testid = 'online-subtitle-search';
        panel.appendChild(host);
      }
      setPortalHost(host);
    };

    attachPortalHost();
    const observer = new MutationObserver(() => {
      attachPortalHost();
      const selected = selectedVttRef.current;
      if (!selected) return;
      const video = document.querySelector<HTMLVideoElement>('video[data-testid="media-element"]');
      if (video && !video.querySelector(`track[${ONLINE_TRACK_ATTRIBUTE}]`)) {
        try {
          installOnlineSubtitle(selected.text, selected.label, selected.language);
        } catch {
          // The player may still be switching sources.
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const offButton = document.querySelector<HTMLElement>('[data-testid="subtitle-off"]');
    offButton?.addEventListener('click', clearOnlineSubtitle);

    return () => {
      observer.disconnect();
      offButton?.removeEventListener('click', clearOnlineSubtitle);
      document.getElementById(HOST_ID)?.remove();
    };
  }, [clearOnlineSubtitle, installOnlineSubtitle]);

  useEffect(() => {
    return () => {
      if (activeObjectUrlRef.current) URL.revokeObjectURL(activeObjectUrlRef.current);
    };
  }, []);

  const searchOnline = useCallback(async () => {
    const cleanedQuery = query.trim();
    if (cleanedQuery.length < 2) {
      setError('Enter at least two characters for the title.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        query: cleanedQuery,
        languages: language,
      });
      if (context?.season) params.set('season', String(context.season));
      if (context?.episode) params.set('episode', String(context.episode));

      const response = await fetch(`/api/subtitles/search?${params.toString()}`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as SearchResponse;
      if (!response.ok) throw new Error(body.error || `Search failed with HTTP ${response.status}`);
      setResults(body.results ?? []);
      setProviders(body.providers ?? []);
      if ((body.results ?? []).length === 0) {
        setError('No matching online subtitles were found. Try editing the title.');
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [context?.episode, context?.season, language, query]);

  useEffect(() => {
    if (!portalHost || !context || query.trim().length < 2) return;
    const key = `${context.title}|${context.season}|${context.episode}|${language}`;
    if (searchedContextRef.current === key) return;
    searchedContextRef.current = key;
    void searchOnline();
  }, [context, language, portalHost, query, searchOnline]);

  const downloadAndApply = async (result: SubtitleResult) => {
    setDownloadingId(result.id);
    setError('');
    try {
      const response = await fetch('/api/subtitles/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: result.provider, id: result.id }),
      });
      const text = await response.text();
      if (!response.ok) {
        let message = text;
        try {
          message = (JSON.parse(text) as { error?: string }).error || text;
        } catch {
          // Keep the provider response text.
        }
        throw new Error(message || `Download failed with HTTP ${response.status}`);
      }

      const label = `${result.providerLabel} · ${languageLabel(result.language)}`;
      installOnlineSubtitle(text, label, result.language);
      setSelectedId(result.id);
      setSelectedLabel(label);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setDownloadingId(null);
    }
  };

  if (!portalHost || !context) return null;

  return createPortal(
    <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-white">
            <Globe2 className="h-4 w-4 text-blue-300" /> Online subtitles
          </div>
          <div className="mt-0.5 text-xs text-white/50">
            OpenSubtitles and SubDL official provider APIs
          </div>
        </div>
        {selectedId && (
          <button
            type="button"
            onClick={clearOnlineSubtitle}
            className="rounded-lg bg-white/5 p-2 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Remove online subtitle"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_145px_auto]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void searchOnline();
          }}
          placeholder="Movie or series title"
          className="min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-red-500/70"
          aria-label="Online subtitle title"
        />
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-sm text-white outline-none focus:border-red-500/70"
          aria-label="Online subtitle language"
        >
          {LANGUAGE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void searchOnline()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </button>
      </div>

      <div className="mt-2 text-[11px] text-white/40">
        {context.season ? `Season ${context.season}` : 'Season not detected'}
        {' · '}
        {context.episode ? `Episode ${context.episode}` : 'Episode not detected'}
      </div>

      {providers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {providers.map((provider) => (
            <span
              key={provider.provider}
              title={provider.message}
              className={`rounded-full px-2 py-1 ${
                provider.ok
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : provider.configured
                    ? 'bg-red-500/10 text-red-300'
                    : 'bg-white/5 text-white/40'
              }`}
            >
              {provider.provider === 'opensubtitles' ? 'OpenSubtitles' : 'SubDL'}:{' '}
              {provider.ok ? 'ready' : provider.configured ? 'error' : 'not configured'}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {selectedLabel && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <Check className="h-4 w-4" /> Applied: {selectedLabel}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
          {results.map((result) => {
            const selected = selectedId === result.id;
            const downloading = downloadingId === result.id;
            return (
              <button
                key={`${result.provider}-${result.id}`}
                type="button"
                onClick={() => void downloadAndApply(result)}
                disabled={downloading}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border-l-2 px-3 py-3 text-left ${
                  selected
                    ? 'border-emerald-400 bg-emerald-950/35'
                    : 'border-white/20 bg-black/20 hover:bg-white/[0.07]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">
                    {result.release || result.fileName}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-white/45">
                    {result.providerLabel} · {languageLabel(result.language)} ·{' '}
                    {formatDownloads(result.downloads)}
                    {result.hearingImpaired ? ' · HI' : ''}
                    {result.fps ? ` · ${result.fps} FPS` : ''}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-white/30">
                    {result.fileName}
                  </div>
                </div>
                <div className="shrink-0 text-white/65">
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : selected ? (
                    <Check className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>,
    portalHost,
  );
}
