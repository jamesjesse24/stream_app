'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { EnhancedVideoPlayer } from '@/components/EnhancedVideoPlayer';
import UHDMoviesAPI from '@/lib/api';
import { Episode, VideoLink } from '@/types';

function mergeSources(primary: VideoLink, groups: VideoLink[][]): VideoLink[] {
  const unique = new Map<string, VideoLink>();
  unique.set(primary.url, primary);
  groups.flat().forEach((source) => {
    if (!source?.url) return;
    const existing = unique.get(source.url);
    if (!existing) {
      unique.set(source.url, source);
      return;
    }

    // Preserve the selected source identity while carrying over metadata such
    // as the file size that was already resolved on the episode page.
    unique.set(source.url, {
      ...source,
      ...existing,
      fileSizeBytes: existing.fileSizeBytes ?? source.fileSizeBytes,
      fileSizeEstimated:
        existing.fileSizeEstimated ?? source.fileSizeEstimated,
      mediaInfoStatus: existing.mediaInfoStatus ?? source.mediaInfoStatus,
      isHls: existing.isHls ?? source.isHls,
      videoUrl: existing.videoUrl ?? source.videoUrl,
    });
  });
  return Array.from(unique.values());
}

export default function WatchPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = useMemo(() => new UHDMoviesAPI(), []);

  const animeSlug = params.slug as string;
  const episodeSlug = params.episodeSlug as string;
  const videoUrl = searchParams.get('video') || '';
  const quality = searchParams.get('quality') || 'Unknown source';
  const initialSource = useMemo<VideoLink>(
    () => ({ url: videoUrl, quality }),
    [quality, videoUrl],
  );
  const [primarySource, setPrimarySource] = useState<VideoLink>(initialSource);
  const [sources, setSources] = useState<VideoLink[]>(videoUrl ? [initialSource] : []);
  const handlePlayerError = useCallback((error: string) => {
    toast.error(error);
  }, []);

  useEffect(() => {
    if (!videoUrl) {
      toast.error('Invalid video URL');
      router.replace(`/anime/${animeSlug}`);
      return;
    }

    let cancelled = false;
    const storageKey = `uhd-player-sources:${animeSlug}:${episodeSlug}`;
    let storedSources: VideoLink[] = [];

    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as VideoLink[];
        if (Array.isArray(parsed)) storedSources = parsed.filter((source) => source?.url);
      }
    } catch {
      // A malformed session entry should not prevent the selected source loading.
    }

    setPrimarySource(initialSource);
    setSources(mergeSources(initialSource, [storedSources]));

    const refreshEpisodeSources = async () => {
      try {
        const animeUrl = decodeURIComponent(animeSlug);
        const episodes = await api.getEpisodeList(animeUrl);
        if (cancelled || episodes.length === 0) return;

        const episodeNumber = Number.parseInt(episodeSlug, 10);
        const selectedEpisode =
          episodes.find((episode) => episode.episodeNumber === episodeNumber) ||
          episodes.find((episode) => String(episode.episodeNumber) === episodeSlug) ||
          episodes[0];

        const freshSources = await api.getVideoLinks(selectedEpisode as Episode);
        if (cancelled || freshSources.length === 0) return;

        // Keep the exact source selected on the episode page as the primary
        // source. A refresh may return several links with the same resolution;
        // selecting the first matching resolution here silently switched users
        // to a different server (often the largest file). Fresh links remain
        // available as fallbacks and can enrich the selected source metadata
        // when their URL matches exactly.
        const merged = mergeSources(initialSource, [
          storedSources,
          freshSources,
        ]);
        setPrimarySource(merged[0] ?? initialSource);
        setSources(merged);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(merged));
        } catch {
          // Playback does not depend on session storage.
        }
      } catch (error) {
        console.warn('Could not refresh alternate playback servers:', error);
      }
    };

    void refreshEpisodeSources();
    return () => {
      cancelled = true;
    };
  }, [animeSlug, api, episodeSlug, initialSource, router, videoUrl]);

  if (!videoUrl) return null;

  return (
    <main className="h-screen min-h-[480px] overflow-hidden bg-black">
      <EnhancedVideoPlayer
        videoLink={primarySource}
        sources={sources}
        contentId={`anime:${decodeURIComponent(animeSlug)}:episode:${episodeSlug}`}
        autoPlay
        title={`Episode ${episodeSlug}`}
        onBack={() => router.push(`/anime/${animeSlug}`)}
        onError={handlePlayerError}
      />
    </main>
  );
}
