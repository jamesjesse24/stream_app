'use client';

import Hls, {
  type AudioSelectionOption,
  type MediaPlaylist,
  type SubtitleSelectionOption,
} from 'hls.js';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  Gauge,
  HardDriveDownload,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Server,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { VideoLink } from '@/types';
import { formatMediaBytes } from '@/lib/media-info';

interface EnhancedVideoPlayerProps {
  videoLink: VideoLink;
  sources?: VideoLink[];
  contentId: string;
  autoPlay?: boolean;
  title?: string;
  onBack?: () => void;
  onError?: (error: string) => void;
}

type PlaybackStatus =
  | 'preparing'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'buffering'
  | 'error';
type SettingsTab = 'quality' | 'audio' | 'subtitles' | 'servers' | 'speed';
type TrackPreference = Pick<AudioSelectionOption, 'lang' | 'name'> &
  Pick<SubtitleSelectionOption, 'lang' | 'name'>;
type SubtitleSelection =
  | { kind: 'off' }
  | { kind: 'hls'; index: number }
  | { kind: 'upload' };
type TimelineHover = { time: number; percent: number };

interface PlaybackProgressRecord {
  version: 2;
  contentId: string;
  position: number;
  duration: number;
  updatedAt: number;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MIN_RESUME_SECONDS = 10;
const PROGRESS_SAVE_INTERVAL_MS = 5_000;
const PROGRESS_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function trackPreference(track: MediaPlaylist): TrackPreference {
  return {
    lang: track.lang || undefined,
    name: track.name || undefined,
  };
}

function findPreferredTrack(
  tracks: MediaPlaylist[],
  preference: TrackPreference | null,
): number {
  if (!preference) return -1;
  const language = preference.lang?.trim().toLowerCase();
  const name = preference.name?.trim().toLowerCase();
  const matchesLanguage = (track: MediaPlaylist) =>
    Boolean(language && track.lang?.trim().toLowerCase() === language);
  const matchesName = (track: MediaPlaylist) =>
    Boolean(name && track.name?.trim().toLowerCase() === name);

  const exact = tracks.findIndex(
    (track) =>
      (!language || matchesLanguage(track)) && (!name || matchesName(track)),
  );
  if (exact >= 0) return exact;
  const languageMatch = tracks.findIndex(matchesLanguage);
  return languageMatch >= 0 ? languageMatch : tracks.findIndex(matchesName);
}

function trackLabel(track: MediaPlaylist, fallback: string): string {
  return track.name?.trim() || track.lang?.trim().toUpperCase() || fallback;
}

function trackDetails(track: MediaPlaylist): string {
  const details = [track.lang?.toUpperCase(), track.channels];
  if (track.default) details.push('Default');
  if (track.forced) details.push('Forced');
  return details.filter(Boolean).join(' · ') || 'Language not specified';
}

function decodeSourceHint(value: string): string {
  let result = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
    } catch {
      break;
    }
  }
  return result;
}

function getResolution(source: VideoLink): string {
  return source.quality.match(/(?:2160|1440|1080|720|480|360)p/i)?.[0] || 'HD';
}

function getServerLabel(source: VideoLink): string {
  const quality = source.quality;
  if (/driveseed\s+cloud/i.test(quality)) return 'DriveSeed Cloud';
  if (/driveseed\s+instant/i.test(quality)) return 'DriveSeed Instant';
  if (/gdrive/i.test(quality)) return 'Google Drive';
  if (/cloudflare|\bCF\b/i.test(quality)) return 'Cloudflare Worker';
  if (/direct/i.test(quality)) return 'Direct';

  const parts = quality.split(' - ').slice(1);
  return parts.join(' - ') || 'Primary server';
}

type GooglePlaybackMode = 'direct' | 'remux' | 'transcode';
type PlaybackStrategy =
  | 'native'
  | 'hls'
  | 'google-direct'
  | 'google-remux'
  | 'google-transcode';

interface PlaybackTarget {
  url: string;
  isHls: boolean;
  strategy: PlaybackStrategy;
}

function isGoogleVideoDownload(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === 'video-downloads.googleusercontent.com' ||
      hostname.endsWith('.video-downloads.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

function getPlaybackUrl(
  source: VideoLink,
  googleMode: GooglePlaybackMode = 'direct',
): PlaybackTarget {
  const decodedUrl = decodeSourceHint(source.url);
  const hint = `${decodedUrl} ${source.quality}`;
  if (/\.m3u8(?:$|[?#])/i.test(decodedUrl)) {
    return { url: source.url, isHls: true, strategy: 'hls' };
  }

  // Google Drive download URLs are already byte-seekable. Sending them
  // directly into the full FFmpeg encode pipeline makes startup much slower
  // than VLC and can leave high-bitrate files permanently buffering. Try a
  // transparent range proxy first, then a video-copy HLS remux, and only use
  // full H.264 transcoding when the browser cannot decode the original media.
  if (isGoogleVideoDownload(decodedUrl)) {
    if (googleMode === 'direct') {
      const params = new URLSearchParams({ url: decodedUrl });
      return {
        url: `/api/google-video?${params.toString()}`,
        isHls: false,
        strategy: 'google-direct',
      };
    }

    const params = new URLSearchParams({
      url: decodedUrl,
      transcode: googleMode === 'transcode' ? '1' : '0',
    });
    return {
      url: `/api/playback-vod?${params.toString()}`,
      isHls: true,
      strategy:
        googleMode === 'transcode' ? 'google-transcode' : 'google-remux',
    };
  }

  const needsCompatibilityStream =
    /driveseed/i.test(source.quality) || /\.mkv(?:$|[?#])/i.test(hint);
  if (!needsCompatibilityStream) {
    return { url: source.url, isHls: false, strategy: 'native' };
  }

  const params = new URLSearchParams({
    url: source.url,
    // Exact four-second HLS boundaries require re-encoding even when the
    // source already contains H.264. Keyframe-only stream copy makes the
    // advertised seek timeline drift away from the real segment durations.
    transcode: '1',
  });
  return {
    url: `/api/playback-vod?${params.toString()}`,
    isHls: true,
    strategy: 'hls',
  };
}

function getBufferedEndForTime(ranges: TimeRanges, time: number): number {
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index);
    const end = ranges.end(index);
    if (time >= start - 0.25 && time <= end + 0.25) return end;
  }
  return time;
}

function getTotalBufferedDuration(ranges: TimeRanges): number {
  let total = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    total += Math.max(0, ranges.end(index) - ranges.start(index));
  }
  return total;
}

function formatBytes(value: number): string {
  return formatMediaBytes(value);
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const seconds = Math.floor(value % 60);
  const minutes = Math.floor((value / 60) % 60);
  const hours = Math.floor(value / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function progressStorageKey(contentId: string): string {
  const value = `v2|${contentId.trim()}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `uhd-player-progress:v2:${(hash >>> 0).toString(16)}`;
}

function completionWindow(duration: number): number {
  return Math.min(120, Math.max(30, duration * 0.02));
}

function isPlaybackComplete(position: number, duration: number): boolean {
  return (
    duration > 0 &&
    position >= duration * 0.9 &&
    position >= duration - completionWindow(duration)
  );
}

function readPlaybackProgress(
  key: string,
  contentId: string,
): PlaybackProgressRecord | null {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const record = JSON.parse(value) as Partial<PlaybackProgressRecord>;
    const valid =
      record.version === 2 &&
      record.contentId === contentId &&
      Number.isFinite(record.position) &&
      Number.isFinite(record.duration) &&
      Number.isFinite(record.updatedAt) &&
      (record.position ?? 0) >= MIN_RESUME_SECONDS &&
      (record.duration ?? 0) > 0 &&
      Date.now() - (record.updatedAt ?? 0) <= PROGRESS_MAX_AGE_MS &&
      !isPlaybackComplete(record.position ?? 0, record.duration ?? 0);
    if (!valid) {
      localStorage.removeItem(key);
      return null;
    }
    return record as PlaybackProgressRecord;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in strict/private browser contexts.
    }
    return null;
  }
}

function srtToVtt(value: string): string {
  return `WEBVTT\n\n${value
    .replace(/^\uFEFF/, '')
    .replace(/\r+/g, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}

export function EnhancedVideoPlayer({
  videoLink,
  sources = [],
  contentId,
  autoPlay = false,
  title,
  onBack,
  onError,
}: EnhancedVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadedSubtitleTrackRef = useRef<HTMLTrackElement>(null);
  const generationRef = useRef(0);
  const failedSourcesRef = useRef(new Set<number>());
  const resumeTimeRef = useRef(0);
  const shouldResumePlayingRef = useRef(autoPlay);
  const lastProgressSaveRef = useRef(0);
  const loadedProgressContentRef = useRef<string | null>(null);
  const progressSnapshotRef = useRef({ position: 0, duration: 0 });
  const subtitleObjectUrlRef = useRef<string | null>(null);
  const preferredAudioRef = useRef<TrackPreference | null>(null);
  const preferredSubtitleRef = useRef<TrackPreference | null>(null);
  const desiredSubtitleSelectionRef = useRef<SubtitleSelection>({ kind: 'off' });
  const lastSubtitleSelectionRef = useRef<SubtitleSelection>({ kind: 'off' });

  const availableSources = useMemo(() => {
    const unique = new Map<string, VideoLink>();
    [videoLink, ...sources].forEach((source) => {
      if (!source?.url) return;
      const existing = unique.get(source.url);
      if (!existing) {
        unique.set(source.url, source);
        return;
      }
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
  }, [sources, videoLink]);
  const progressKey = useMemo(() => progressStorageKey(contentId), [contentId]);
  const availableSourcesRef = useRef(availableSources);

  useEffect(() => {
    availableSourcesRef.current = availableSources;
  }, [availableSources]);

  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [googlePlaybackOverride, setGooglePlaybackOverride] = useState<{
    sourceUrl: string;
    mode: GooglePlaybackMode;
  } | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>('preparing');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [timelineHover, setTimelineHover] = useState<TimelineHover | null>(null);
  const [duration, setDuration] = useState(0);
  const [bufferedUntil, setBufferedUntil] = useState(0);
  const [bufferedDuration, setBufferedDuration] = useState(0);
  const [hlsBitrate, setHlsBitrate] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('servers');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioTracks, setAudioTracks] = useState<MediaPlaylist[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<MediaPlaylist[]>([]);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [subtitleLabel, setSubtitleLabel] = useState<string | null>(null);
  const [subtitleSelection, setSubtitleSelection] = useState<SubtitleSelection>({
    kind: 'off',
  });

  const activeSource = availableSources[activeSourceIndex] || availableSources[0];
  // Keep playback keyed only to fields that actually change the media URL.
  // File-size/status metadata may arrive after mount and must never recreate
  // the HLS instance or reload the video element.
  const activePlaybackSource = useMemo<VideoLink | null>(
    () =>
      activeSource
        ? {
            url: activeSource.url,
            quality: activeSource.quality,
          }
        : null,
    [activeSource?.quality, activeSource?.url],
  );
  const activeGooglePlaybackMode: GooglePlaybackMode =
    googlePlaybackOverride?.sourceUrl === activePlaybackSource?.url
      ? googlePlaybackOverride.mode
      : 'direct';
  const activePlaybackTarget = useMemo<PlaybackTarget | null>(
    () =>
      activePlaybackSource
        ? getPlaybackUrl(activePlaybackSource, activeGooglePlaybackMode)
        : null,
    [activeGooglePlaybackMode, activePlaybackSource],
  );
  const subtitlesEnabled = subtitleSelection.kind !== 'off';

  useEffect(() => {
    if (activeSourceIndex >= availableSources.length) setActiveSourceIndex(0);
  }, [activeSourceIndex, availableSources.length]);

  useEffect(() => {
    if (
      googlePlaybackOverride &&
      googlePlaybackOverride.sourceUrl !== activePlaybackSource?.url
    ) {
      setGooglePlaybackOverride(null);
    }
  }, [activePlaybackSource?.url, googlePlaybackOverride]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isPlaying && !settingsOpen) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 2800);
    }
  }, [isPlaying, settingsOpen]);

  const commitSeek = useCallback(
    (requestedTime: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(requestedTime)) return;

      const nextTime = Math.max(0, Math.min(duration || Infinity, requestedTime));
      if (nextTime < MIN_RESUME_SECONDS) {
        try {
          localStorage.removeItem(progressKey);
        } catch {
          // Seeking must keep working when storage is unavailable.
        }
      }
      if (Math.abs(video.currentTime - nextTime) < 0.05 && !video.seeking) {
        pendingSeekRef.current = null;
        setSeekPreview(null);
        setCurrentTime(video.currentTime);
        return;
      }
      pendingSeekRef.current = nextTime;
      setSeekPreview(nextTime);
      setCurrentTime(nextTime);
      setBufferedUntil(getBufferedEndForTime(video.buffered, nextTime));
      setStatus('buffering');
      video.currentTime = nextTime;

      // A normal media-element seek is handled by hls.js. startLoad() is only
      // needed if loading was explicitly stopped; restarting an active loader
      // here would cancel the new video/audio/subtitle fragment requests.
      const hls = hlsRef.current;
      if (hls && !hls.loadingEnabled) hls.startLoad(nextTime);
      revealControls();
    },
    [duration, progressKey, revealControls],
  );

  useEffect(() => {
    revealControls();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [revealControls]);

  const persistPlaybackPosition = useCallback((force = false) => {
    const video = videoRef.current;
    const position =
      video && Number.isFinite(video.currentTime)
        ? video.currentTime
        : progressSnapshotRef.current.position;
    const mediaDuration =
      video && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : progressSnapshotRef.current.duration;
    progressSnapshotRef.current = { position, duration: mediaDuration };

    try {
      if (isPlaybackComplete(position, mediaDuration)) {
        localStorage.removeItem(progressKey);
        return;
      }
      if (position < MIN_RESUME_SECONDS || mediaDuration <= 0) return;
      if (
        !force &&
        Date.now() - lastProgressSaveRef.current < PROGRESS_SAVE_INTERVAL_MS
      ) {
        return;
      }

      const now = Date.now();
      lastProgressSaveRef.current = now;
      const record: PlaybackProgressRecord = {
        version: 2,
        contentId,
        position: Math.round(position * 10) / 10,
        duration: Math.round(mediaDuration * 10) / 10,
        updatedAt: now,
      };
      localStorage.setItem(progressKey, JSON.stringify(record));
    } catch {
      // Playback must continue when storage is unavailable.
    }
  }, [contentId, progressKey]);

  useEffect(() => {
    const flush = () => persistPlaybackPosition(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flush();
    };
  }, [persistPlaybackPosition]);

  const switchSource = useCallback(
    (index: number) => {
      if (index < 0 || index >= availableSources.length) return;
      persistPlaybackPosition(true);
      setGooglePlaybackOverride(null);
      const video = videoRef.current;
      if (video) {
        resumeTimeRef.current = video.currentTime;
        shouldResumePlayingRef.current = !video.paused;
      }
      failedSourcesRef.current.delete(index);
      setErrorMessage('');
      setStatus('preparing');
      setSettingsOpen(false);
      if (index === activeSourceIndex) setReloadToken((value) => value + 1);
      else setActiveSourceIndex(index);
    },
    [activeSourceIndex, availableSources.length, persistPlaybackPosition],
  );

  const failCurrentSource = useCallback(
    (message: string) => {
      pendingSeekRef.current = null;
      setSeekPreview(null);
      persistPlaybackPosition(true);
      failedSourcesRef.current.add(activeSourceIndex);
      const nextIndex = availableSourcesRef.current.findIndex(
        (_, index) => !failedSourcesRef.current.has(index),
      );

      if (nextIndex >= 0) {
        const video = videoRef.current;
        if (video) {
          resumeTimeRef.current = video.currentTime;
          shouldResumePlayingRef.current = !video.paused || autoPlay;
        }
        setStatus('preparing');
        setGooglePlaybackOverride(null);
        setActiveSourceIndex(nextIndex);
        return;
      }

      setStatus('error');
      setErrorMessage(message);
      setIsPlaying(false);
      onError?.(message);
    },
    [activeSourceIndex, autoPlay, onError, persistPlaybackPosition],
  );

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activePlaybackSource || !activePlaybackTarget) return;

    const generation = ++generationRef.current;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    let hlsDiagnostics = 0;
    let autoplayAttempted = false;
    let restoredPosition = false;
    let disposed = false;
    let sourceFailureHandled = false;
    let hlsInstance: Hls | null = null;
    let startupWatchdog: ReturnType<typeof setTimeout> | null = null;
    const recoveryTimers = new Set<ReturnType<typeof setTimeout>>();
    const playback = activePlaybackTarget;

    const isGenerationActive = () =>
      !disposed && generation === generationRef.current;

    const clearRecoveryTimers = () => {
      recoveryTimers.forEach((timer) => clearTimeout(timer));
      recoveryTimers.clear();
      if (startupWatchdog) {
        clearTimeout(startupWatchdog);
        startupWatchdog = null;
      }
    };

    const advanceGoogleCompatibility = (message: string): boolean => {
      const nextMode: GooglePlaybackMode | null =
        playback.strategy === 'google-direct'
          ? 'remux'
          : playback.strategy === 'google-remux'
            ? 'transcode'
            : null;
      if (!nextMode || sourceFailureHandled || !isGenerationActive()) return false;

      sourceFailureHandled = true;
      clearRecoveryTimers();
      const currentPosition = Number.isFinite(video.currentTime)
        ? video.currentTime
        : 0;
      if (currentPosition > 0) resumeTimeRef.current = currentPosition;
      shouldResumePlayingRef.current = !video.paused || autoPlay;
      console.warn(
        `Google playback ${playback.strategy} failed; switching to ${nextMode}:`,
        message,
      );
      setErrorMessage('');
      setStatus('preparing');
      setGooglePlaybackOverride({
        sourceUrl: activePlaybackSource.url,
        mode: nextMode,
      });
      return true;
    };

    const failSourceOnce = (message: string) => {
      if (!isGenerationActive() || sourceFailureHandled) return;
      sourceFailureHandled = true;
      clearRecoveryTimers();
      failCurrentSource(message);
    };

    const pendingPosition = pendingSeekRef.current;
    if (loadedProgressContentRef.current === contentId) {
      const currentPosition =
        pendingPosition ??
        (Number.isFinite(video.currentTime) ? video.currentTime : 0);
      if (currentPosition > 0) resumeTimeRef.current = currentPosition;
      shouldResumePlayingRef.current = !video.paused || autoPlay;
    }
    pendingSeekRef.current = null;
    setSeekPreview(null);
    setStatus('loading');
    setErrorMessage('');
    setBufferedUntil(0);
    setBufferedDuration(0);
    setHlsBitrate(0);
    setDuration(0);
    setCurrentTime(0);
    setAudioTracks([]);
    setActiveAudioTrack(-1);
    setSubtitleTracks([]);
    setSubtitleSelection(
      desiredSubtitleSelectionRef.current.kind === 'upload'
        ? { kind: 'upload' }
        : { kind: 'off' },
    );

    hlsRef.current?.destroy();
    hlsRef.current = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.playbackRate = playbackRate;

    if (loadedProgressContentRef.current !== contentId) {
      loadedProgressContentRef.current = contentId;
      const saved = readPlaybackProgress(progressKey, contentId);
      resumeTimeRef.current = saved?.position ?? 0;
      progressSnapshotRef.current = {
        position: saved?.position ?? 0,
        duration: saved?.duration ?? 0,
      };
      lastProgressSaveRef.current = 0;
    }

    const restorePosition = () => {
      if (restoredPosition || resumeTimeRef.current <= 0) return;
      const target = resumeTimeRef.current;
      if (video.seekable.length > 0) {
        const start = video.seekable.start(0);
        const end = video.seekable.end(video.seekable.length - 1);
        if (target >= start && target <= end) {
          video.currentTime = target;
          restoredPosition = true;
        }
      }
    };

    const tryAutoPlay = async () => {
      if (autoplayAttempted || (!autoPlay && !shouldResumePlayingRef.current)) return;
      autoplayAttempted = true;
      try {
        await video.play();
      } catch (error) {
        if ((error as DOMException)?.name !== 'NotAllowedError') {
          console.warn('Playback could not start automatically:', error);
        }
        setIsPlaying(false);
      }
    };

    const handleCanPlay = () => {
      if (!isGenerationActive()) return;
      if (startupWatchdog) {
        clearTimeout(startupWatchdog);
        startupWatchdog = null;
      }
      restorePosition();
      setStatus(video.paused ? 'ready' : 'playing');
      void tryAutoPlay();
    };

    const handleLoadedMetadata = () => {
      if (!isGenerationActive()) return;
      restorePosition();
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };

    const handleWaiting = () => {
      if (isGenerationActive()) setStatus('buffering');
    };

    const handleVideoError = () => {
      const mediaError = video.error;
      const message =
        mediaError?.message || `Unable to play ${getServerLabel(activePlaybackSource)}`;
      if (advanceGoogleCompatibility(message)) return;
      failSourceOnce(message);
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('error', handleVideoError);

    if (playback.strategy === 'google-direct') {
      startupWatchdog = setTimeout(() => {
        if (!isGenerationActive() || video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          return;
        }
        advanceGoogleCompatibility('Direct playback did not become ready in time');
      }, 12_000);
    }

    if (playback.isHls && Hls.isSupported()) {
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: resumeTimeRef.current > 0 ? resumeTimeRef.current : 0,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 30,
        maxFragLookUpTolerance: 0.05,
        manifestLoadingMaxRetry: 5,
        levelLoadingMaxRetry: 5,
        // A cold random seek asks the server to create a short FFmpeg window
        // at that timestamp. Allow enough first-byte time for remote MKV index
        // lookup and packaging while retaining bounded retries.
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 150_000,
            maxLoadTimeMs: 210_000,
            timeoutRetry: {
              maxNumRetry: 3,
              retryDelayMs: 750,
              maxRetryDelayMs: 4_000,
            },
            errorRetry: {
              maxNumRetry: 4,
              retryDelayMs: 1_000,
              maxRetryDelayMs: 8_000,
            },
          },
        },
      });
      const hls = hlsInstance;
      const audioPreference = preferredAudioRef.current;
      if (audioPreference) hls.setAudioOption(audioPreference);

      const desiredSubtitle = desiredSubtitleSelectionRef.current;
      const subtitlePreference = preferredSubtitleRef.current;
      if (desiredSubtitle.kind === 'hls' && subtitlePreference) {
        hls.subtitleDisplay = true;
        hls.setSubtitleOption(subtitlePreference);
      } else {
        // Prevent a manifest default from overriding an explicit Off or
        // uploaded-subtitle selection while a new source is loading.
        hls.subtitleDisplay = false;
        hls.setSubtitleOption({ id: -1 });
      }

      let currentAudioTracks: MediaPlaylist[] = [];
      let currentSubtitleTracks: MediaPlaylist[] = [];
      const syncAudioTracks = (incomingTracks: MediaPlaylist[]) => {
        if (!isGenerationActive()) return;
        const tracks = incomingTracks.slice();
        currentAudioTracks = tracks;
        setAudioTracks(tracks);
        const preferredIndex = findPreferredTrack(tracks, preferredAudioRef.current);
        const selectedTrack = hls.audioTracks[hls.audioTrack];
        const selectedIndex = selectedTrack
          ? findPreferredTrack(tracks, trackPreference(selectedTrack))
          : -1;
        setActiveAudioTrack(selectedIndex);

        if (preferredIndex >= 0) {
          const currentGroupIndex = findPreferredTrack(
            hls.audioTracks,
            preferredAudioRef.current,
          );
          if (currentGroupIndex >= 0 && hls.audioTrack !== currentGroupIndex) {
            hls.setAudioOption(hls.audioTracks[currentGroupIndex]);
          }
        }
      };
      const syncSubtitleTracks = (incomingTracks: MediaPlaylist[]) => {
        if (!isGenerationActive()) return;
        const tracks = incomingTracks.slice();
        currentSubtitleTracks = tracks;
        setSubtitleTracks(tracks);

        const desired = desiredSubtitleSelectionRef.current;
        if (desired.kind === 'upload') {
          setSubtitleSelection({ kind: 'upload' });
          return;
        }
        if (desired.kind !== 'hls') {
          setSubtitleSelection({ kind: 'off' });
          return;
        }

        const index = findPreferredTrack(tracks, preferredSubtitleRef.current);
        if (index < 0) {
          setSubtitleSelection({ kind: 'off' });
          return;
        }

        hls.subtitleDisplay = true;
        const currentGroupIndex = findPreferredTrack(
          hls.subtitleTracks,
          preferredSubtitleRef.current,
        );
        const currentTrack =
          currentGroupIndex >= 0 ? hls.subtitleTracks[currentGroupIndex] : tracks[index];
        hls.setSubtitleOption(currentTrack);
        if (currentGroupIndex >= 0) {
          if (hls.subtitleTrack === currentGroupIndex) {
            const selection: SubtitleSelection = { kind: 'hls', index };
            lastSubtitleSelectionRef.current = selection;
            setSubtitleSelection(selection);
          }
        }
      };

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (isGenerationActive()) hls.loadSource(playback.url);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (!isGenerationActive()) return;
        syncAudioTracks(data.audioTracks);
        syncSubtitleTracks(data.subtitleTracks);
        const initialLevelIndex = hls.firstLevel >= 0 ? hls.firstLevel : 0;
        setHlsBitrate(hls.levels[initialLevelIndex]?.bitrate ?? 0);
        setStatus('ready');
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        if (!isGenerationActive()) return;
        setHlsBitrate(hls.levels[data.level]?.bitrate ?? 0);
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        syncAudioTracks(data.audioTracks);
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHING, (_, data) => {
        if (!isGenerationActive()) return;
        const track = hls.audioTracks[data.id];
        if (track) preferredAudioRef.current = trackPreference(track);
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        if (!isGenerationActive()) return;
        const track = hls.audioTracks[data.id] || data;
        const index = findPreferredTrack(
          currentAudioTracks,
          trackPreference(track),
        );
        setActiveAudioTrack(index >= 0 ? index : data.id);
        preferredAudioRef.current = trackPreference(track);
      });
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
        syncSubtitleTracks(data.subtitleTracks);
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, data) => {
        if (!isGenerationActive()) return;
        const desired = desiredSubtitleSelectionRef.current;
        if (data.id >= 0 && desired.kind !== 'hls') {
          hls.subtitleDisplay = false;
          if (hls.subtitleTrack !== -1) hls.subtitleTrack = -1;
          setSubtitleSelection(
            desired.kind === 'upload' ? { kind: 'upload' } : { kind: 'off' },
          );
          return;
        }
        if (data.id < 0) {
          setSubtitleSelection(
            desired.kind === 'upload'
              ? { kind: 'upload' }
              : { kind: 'off' },
          );
          return;
        }

        const track = hls.subtitleTracks[data.id] || currentSubtitleTracks[data.id];
        if (!track) return;
        const displayIndex = findPreferredTrack(
          currentSubtitleTracks,
          trackPreference(track),
        );
        const selection: SubtitleSelection = {
          kind: 'hls',
          index: displayIndex >= 0 ? displayIndex : data.id,
        };
        preferredSubtitleRef.current = trackPreference(track);
        desiredSubtitleSelectionRef.current = selection;
        lastSubtitleSelectionRef.current = selection;
        setSubtitleSelection(selection);
      });
      hls.on(Hls.Events.SUBTITLE_TRACKS_CLEARED, () => {
        if (!isGenerationActive()) return;
        currentSubtitleTracks = [];
        setSubtitleTracks([]);
        setSubtitleSelection(
          desiredSubtitleSelectionRef.current.kind === 'upload'
            ? { kind: 'upload' }
            : { kind: 'off' },
        );
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!isGenerationActive() || sourceFailureHandled) return;
        if (hlsDiagnostics < 8) {
          console.warn(
            'HLS playback diagnostic:',
            JSON.stringify({
              type: data.type,
              details: data.details,
              fatal: data.fatal,
              error: data.error?.message,
            }),
          );
          hlsDiagnostics += 1;
        }
        if (!data.fatal) return;

        // A remux attempt can fail when the source video is not H.264. Move
        // immediately to the accurate transcode path instead of retrying the
        // same incompatible manifest several times.
        if (playback.strategy === 'google-remux') {
          if (advanceGoogleCompatibility(data.error?.message || data.details)) return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) {
          networkRecoveries += 1;
          setStatus('buffering');
          const recoveryTimer = setTimeout(() => {
            recoveryTimers.delete(recoveryTimer);
            if (isGenerationActive() && !sourceFailureHandled) hls.startLoad();
          }, 750 * networkRecoveries);
          recoveryTimers.add(recoveryTimer);
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
          mediaRecoveries += 1;
          hls.recoverMediaError();
          return;
        }

        failSourceOnce(data.error?.message || data.details || 'HLS playback failed');
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
    } else {
      video.src = playback.url;
      video.load();
    }

    return () => {
      disposed = true;
      if (generationRef.current === generation) generationRef.current += 1;
      clearRecoveryTimers();
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleVideoError);
      hlsInstance?.destroy();
      if (hlsRef.current === hlsInstance) {
        hlsRef.current = null;
      }
    };
  }, [
    activePlaybackSource,
    activePlaybackTarget,
    autoPlay,
    contentId,
    failCurrentSource,
    progressKey,
    reloadToken,
  ]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      const video = videoRef.current;
      if (!video) return;

      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        commitSeek(video.currentTime - 10);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        commitSeek(video.currentTime + 10);
      } else if (event.key.toLowerCase() === 'm') {
        video.muted = !video.muted;
        setIsMuted(video.muted);
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else if (containerRef.current) void containerRef.current.requestFullscreen();
      } else if (event.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false);
      }
      revealControls();
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [commitSeek, revealControls, settingsOpen]);

  useEffect(() => {
    const uploadedTrack = uploadedSubtitleTrackRef.current?.track;
    if (uploadedTrack) {
      uploadedTrack.mode =
        subtitleSelection.kind === 'upload' ? 'showing' : 'disabled';
    }
  }, [subtitleSelection, subtitleUrl]);

  useEffect(() => {
    return () => {
      if (subtitleObjectUrlRef.current) URL.revokeObjectURL(subtitleObjectUrlRef.current);
    };
  }, []);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    revealControls();
    if (video.paused) {
      try {
        await video.play();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Playback failed');
      }
    } else {
      video.pause();
    }
  };

  const commitPendingSeek = () => {
    const pending = pendingSeekRef.current;
    if (pending !== null) commitSeek(pending);
  };

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    commitSeek(video.currentTime + seconds);
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    if (!Number.isFinite(nextTime)) return;

    pendingSeekRef.current = nextTime;
    setSeekPreview(nextTime);
  };

  const handleTimelinePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!(duration > 0)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!(bounds.width > 0)) return;
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    setTimelineHover({ time: ratio * duration, percent: ratio * 100 });
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const handleVolume = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Number(event.target.value);
    const video = videoRef.current;
    if (!video) return;
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    setVolume(nextVolume);
    setIsMuted(video.muted);
  };

  const selectSpeed = (speed: number) => {
    setPlaybackRate(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    setSettingsOpen(false);
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (containerRef.current) await containerRef.current.requestFullscreen();
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  };

  const selectAudioTrack = (index: number) => {
    const hls = hlsRef.current;
    const track = audioTracks[index];
    if (!hls || !track) return;

    const preference = trackPreference(track);
    preferredAudioRef.current = preference;
    const currentGroupIndex = findPreferredTrack(hls.audioTracks, preference);
    hls.setAudioOption(
      currentGroupIndex >= 0 ? hls.audioTracks[currentGroupIndex] : track,
    );
    if (currentGroupIndex >= 0 && hls.audioTrack === currentGroupIndex) {
      setActiveAudioTrack(index);
    }
  };

  const selectSubtitlesOff = () => {
    const selection: SubtitleSelection = { kind: 'off' };
    desiredSubtitleSelectionRef.current = selection;
    setSubtitleSelection(selection);
    const uploadedTrack = uploadedSubtitleTrackRef.current?.track;
    if (uploadedTrack) uploadedTrack.mode = 'disabled';

    const hls = hlsRef.current;
    if (hls) {
      hls.setSubtitleOption({ id: -1 });
      hls.subtitleDisplay = false;
    }
  };

  const selectBuiltInSubtitle = (index: number) => {
    const hls = hlsRef.current;
    const track = subtitleTracks[index];
    if (!hls || !track) return;

    const selection: SubtitleSelection = { kind: 'hls', index };
    const preference = trackPreference(track);
    preferredSubtitleRef.current = preference;
    desiredSubtitleSelectionRef.current = selection;

    const uploadedTrack = uploadedSubtitleTrackRef.current?.track;
    if (uploadedTrack) uploadedTrack.mode = 'disabled';
    hls.subtitleDisplay = true;
    const currentGroupIndex = findPreferredTrack(hls.subtitleTracks, preference);
    hls.setSubtitleOption(
      currentGroupIndex >= 0 ? hls.subtitleTracks[currentGroupIndex] : track,
    );
    if (currentGroupIndex >= 0 && hls.subtitleTrack === currentGroupIndex) {
      lastSubtitleSelectionRef.current = selection;
      setSubtitleSelection(selection);
    }
  };

  const selectUploadedSubtitle = () => {
    const selection: SubtitleSelection = { kind: 'upload' };
    desiredSubtitleSelectionRef.current = selection;
    lastSubtitleSelectionRef.current = selection;
    setSubtitleSelection(selection);

    const hls = hlsRef.current;
    if (hls) {
      hls.setSubtitleOption({ id: -1 });
      hls.subtitleDisplay = false;
    }
    const uploadedTrack = uploadedSubtitleTrackRef.current?.track;
    if (uploadedTrack) uploadedTrack.mode = 'showing';
  };

  const toggleSubtitles = () => {
    if (subtitleSelection.kind !== 'off') {
      selectSubtitlesOff();
      return;
    }

    const lastSelection = lastSubtitleSelectionRef.current;
    if (lastSelection.kind === 'upload' && subtitleUrl) {
      selectUploadedSubtitle();
      return;
    }

    const preferredIndex = findPreferredTrack(
      subtitleTracks,
      preferredSubtitleRef.current,
    );
    if (preferredIndex >= 0) {
      selectBuiltInSubtitle(preferredIndex);
      return;
    }

    const defaultIndex = subtitleTracks.findIndex((track) => track.default);
    if (subtitleTracks.length > 0) {
      selectBuiltInSubtitle(defaultIndex >= 0 ? defaultIndex : 0);
    } else if (subtitleUrl) {
      selectUploadedSubtitle();
    }
  };

  const handleSubtitleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const vtt = file.name.toLowerCase().endsWith('.srt') ? srtToVtt(text) : text;
    if (!vtt.trimStart().startsWith('WEBVTT')) {
      setErrorMessage('Subtitle file must be WebVTT or SRT');
      return;
    }

    if (subtitleObjectUrlRef.current) URL.revokeObjectURL(subtitleObjectUrlRef.current);
    const objectUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    subtitleObjectUrlRef.current = objectUrl;
    setSubtitleUrl(objectUrl);
    setSubtitleLabel(file.name);
    selectUploadedSubtitle();
    event.target.value = '';
  };

  const displayedTime = seekPreview ?? currentTime;
  const progressPercent = duration > 0 ? Math.min(100, (displayedTime / duration) * 100) : 0;
  const bufferedPercent =
    duration > 0
      ? Math.max(progressPercent, Math.min(100, (bufferedUntil / duration) * 100))
      : 0;
  const activePlaybackIsHls = activePlaybackSource
    ? getPlaybackUrl(activePlaybackSource).isHls
    : false;
  const suppliedSourceSizeBytes =
    activeSource &&
    Number.isFinite(activeSource.fileSizeBytes) &&
    (activeSource.fileSizeBytes ?? 0) > 0
      ? activeSource.fileSizeBytes ?? null
      : null;
  const estimatedHlsSizeBytes =
    activePlaybackIsHls && duration > 0 && hlsBitrate > 0
      ? (duration * hlsBitrate) / 8
      : null;
  const episodeSizeBytes = suppliedSourceSizeBytes ?? estimatedHlsSizeBytes;
  const sizeIsEstimated =
    Boolean(activeSource?.fileSizeEstimated) ||
    (suppliedSourceSizeBytes === null && estimatedHlsSizeBytes !== null);
  const directBufferedBytes =
    !activePlaybackIsHls && episodeSizeBytes !== null && duration > 0
      ? episodeSizeBytes * Math.min(1, bufferedDuration / duration)
      : 0;
  // HLS loaded bytes are estimated from the buffered media duration. This
  // avoids a React state update on every fragment, which previously caused
  // tiny playback interruptions on some systems.
  const hlsBufferedBytes =
    activePlaybackIsHls && hlsBitrate > 0
      ? (bufferedDuration * hlsBitrate) / 8
      : 0;
  const measuredLoadedBytes = activePlaybackIsHls
    ? hlsBufferedBytes
    : directBufferedBytes;
  const loadedBytes =
    episodeSizeBytes !== null
      ? Math.min(episodeSizeBytes, measuredLoadedBytes)
      : measuredLoadedBytes;
  const loadedPercent =
    episodeSizeBytes !== null && episodeSizeBytes > 0
      ? Math.min(100, (loadedBytes / episodeSizeBytes) * 100)
      : null;
  const episodeSizeLabel =
    episodeSizeBytes !== null
      ? `${sizeIsEstimated ? '~' : ''}${formatBytes(episodeSizeBytes)}`
      : activePlaybackIsHls
        ? 'Estimating…'
        : 'Not listed';
  const loadedSizeLabel =
    loadedBytes > 0
      ? `${formatBytes(loadedBytes)}${
          episodeSizeBytes !== null ? ` / ${formatBytes(episodeSizeBytes)}` : ''
        }${loadedPercent !== null ? ` (${loadedPercent.toFixed(0)}%)` : ''}`
      : episodeSizeBytes !== null
        ? `0 MB / ${formatBytes(episodeSizeBytes)} (0%)`
        : 'Waiting for data…';
  const sourceResolution = activeSource ? getResolution(activeSource) : 'HD';
  const statusLabel =
    status === 'preparing'
      ? 'Preparing stream…'
      : status === 'loading'
        ? 'Loading stream…'
        : status === 'buffering'
          ? 'Buffering…'
          : '';
  const sourceFileSizeLabel = (source: VideoLink): string => {
    const bytes =
      Number.isFinite(source.fileSizeBytes) && (source.fileSizeBytes ?? 0) > 0
        ? source.fileSizeBytes ?? null
        : null;
    if (bytes !== null) {
      return `${source.fileSizeEstimated ? '~' : ''}${formatBytes(bytes)}`;
    }
    return getPlaybackUrl(source).isHls ? 'Estimated when selected' : 'Not listed';
  };

  const qualityOptions = useMemo(() => {
    const grouped = new Map<
      string,
      Array<{ source: VideoLink; index: number; resolution: string }>
    >();

    availableSources.forEach((source, index) => {
      const resolution = getResolution(source);
      const options = grouped.get(resolution) ?? [];
      options.push({ source, index, resolution });
      grouped.set(resolution, options);
    });

    return Array.from(grouped.values()).map((options) => {
      const resolution = options[0].resolution;

      // For the active resolution, the quality card must represent the exact
      // server the user selected rather than the first source with that label.
      const activeOption = options.find(({ index }) => index === activeSourceIndex);
      if (activeOption) return activeOption;

      // When changing resolution, prefer the same server family. If that is
      // unavailable, prefer the smallest known file instead of silently
      // choosing the largest same-resolution source.
      const activeServer = activeSource ? getServerLabel(activeSource) : null;
      const sameServer = activeServer
        ? options.find(({ source }) => getServerLabel(source) === activeServer)
        : undefined;
      if (sameServer) return sameServer;

      return [...options].sort((left, right) => {
        const leftSize =
          Number.isFinite(left.source.fileSizeBytes) &&
          (left.source.fileSizeBytes ?? 0) > 0
            ? left.source.fileSizeBytes!
            : Number.POSITIVE_INFINITY;
        const rightSize =
          Number.isFinite(right.source.fileSizeBytes) &&
          (right.source.fileSizeBytes ?? 0) > 0
            ? right.source.fileSizeBytes!
            : Number.POSITIVE_INFINITY;
        return leftSize - rightSize || left.index - right.index;
      })[0];
    });
  }, [activeSource, activeSourceIndex, availableSources]);

  return (
    <div
      ref={containerRef}
      data-testid="enhanced-video-player"
      data-audio-track-count={audioTracks.length}
      data-subtitle-track-count={subtitleTracks.length}
      data-active-audio={activeAudioTrack}
      data-active-subtitle={
        subtitleSelection.kind === 'hls'
          ? `hls:${subtitleSelection.index}`
          : subtitleSelection.kind
      }
      data-seek-preview={seekPreview ?? ''}
      data-episode-size-bytes={episodeSizeBytes ?? ''}
      data-loaded-bytes={loadedBytes}
      className="group relative h-full min-h-[420px] w-full overflow-hidden bg-black text-white"
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (isPlaying && !settingsOpen) setShowControls(false);
      }}
    >
      <video
        ref={videoRef}
        data-testid="media-element"
        className="h-full w-full bg-black object-contain"
        playsInline
        preload="auto"
        onClick={() => void togglePlayback()}
        onPlay={() => {
          setIsPlaying(true);
          setStatus('playing');
          revealControls();
        }}
        onPause={() => {
          setIsPlaying(false);
          if (status !== 'error') setStatus('ready');
          persistPlaybackPosition(true);
        }}
        onPlaying={() => setStatus('playing')}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (pendingSeekRef.current === null) setCurrentTime(video.currentTime);
          setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          setBufferedUntil(getBufferedEndForTime(video.buffered, video.currentTime));
          setBufferedDuration(getTotalBufferedDuration(video.buffered));
          persistPlaybackPosition(false);
        }}
        onProgress={(event) => {
          const video = event.currentTarget;
          const target = pendingSeekRef.current ?? video.currentTime;
          setBufferedUntil(getBufferedEndForTime(video.buffered, target));
          setBufferedDuration(getTotalBufferedDuration(video.buffered));
        }}
        onSeeking={() => setStatus('buffering')}
        onSeeked={(event) => {
          const video = event.currentTarget;
          pendingSeekRef.current = null;
          setSeekPreview(null);
          setCurrentTime(video.currentTime);
          setBufferedUntil(getBufferedEndForTime(video.buffered, video.currentTime));
          setBufferedDuration(getTotalBufferedDuration(video.buffered));
          progressSnapshotRef.current = {
            position: video.currentTime,
            duration: Number.isFinite(video.duration) ? video.duration : 0,
          };
          setStatus(video.paused ? 'ready' : 'playing');
        }}
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          const finiteDuration = Number.isFinite(nextDuration) ? nextDuration : 0;
          setDuration(finiteDuration);
          progressSnapshotRef.current = {
            position: event.currentTarget.currentTime,
            duration: finiteDuration,
          };
        }}
        onEnded={() => {
          try {
            localStorage.removeItem(progressKey);
          } catch {
            // Playback completion must not fail when storage is unavailable.
          }
          resumeTimeRef.current = 0;
          progressSnapshotRef.current = { position: 0, duration: 0 };
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setIsMuted(event.currentTarget.muted);
        }}
      >
        {subtitleUrl && (
          <track
            key={subtitleUrl}
            ref={uploadedSubtitleTrackRef}
            kind="subtitles"
            src={subtitleUrl}
            srcLang="en"
            label={subtitleLabel || 'Uploaded subtitles'}
          />
        )}
      </video>

      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 via-transparent to-black/90 transition-opacity duration-300 ${
          showControls || settingsOpen || !isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center gap-3 p-4 transition-opacity duration-300 ${
          showControls || settingsOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {onBack && (
          <button
            type="button"
            onClick={() => {
              persistPlaybackPosition(true);
              onBack();
            }}
            className="rounded-full bg-black/45 p-2.5 text-white backdrop-blur hover:bg-white/15"
            aria-label="Back"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
        )}
        <div className="min-w-0">
          {title && <div className="truncate text-base font-semibold sm:text-lg">{title}</div>}
          <div className="truncate text-xs text-white/65">
            {sourceResolution} · {activeSource ? getServerLabel(activeSource) : 'Preparing'}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-white/55 sm:text-xs">
            File size: <span className="text-white/80">{episodeSizeLabel}</span>
            <span className="mx-1.5 text-white/25">•</span>
            Loaded: <span className="text-white/80">{loadedSizeLabel}</span>
          </div>
        </div>
      </div>

      {(status === 'preparing' || status === 'loading' || status === 'buffering') && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/55 px-6 py-5 backdrop-blur-md">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-red-500" />
            <span className="text-sm font-medium text-white/85">{statusLabel}</span>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-400">
              <X className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">This server could not play the video</h2>
            <p className="mt-2 text-sm text-white/60">{errorMessage}</p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  failedSourcesRef.current.clear();
                  switchSource(activeSourceIndex);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold hover:bg-red-500"
              >
                <RotateCcw className="h-4 w-4" /> Retry
              </button>
              {availableSources.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setSettingsTab('servers');
                    setSettingsOpen(true);
                    setStatus('ready');
                  }}
                  className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/15"
                >
                  Choose server
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!isPlaying && status !== 'error' && status !== 'loading' && status !== 'preparing' && (
        <button
          type="button"
          onClick={() => void togglePlayback()}
          className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/90 p-5 shadow-2xl transition hover:scale-105 hover:bg-red-500"
          aria-label="Play"
        >
          <Play className="h-9 w-9 fill-current" />
        </button>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 z-20 space-y-3 p-4 transition-all duration-300 sm:p-5 ${
          showControls || settingsOpen || !isPlaying
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <div
          data-testid="stream-file-info"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-white/65 sm:text-xs"
          aria-live="polite"
        >
          <span>
            Episode size: <span className="text-white/90">{episodeSizeLabel}</span>
            {sizeIsEstimated && <span className="ml-1 text-white/45">estimated</span>}
          </span>
          <span className="hidden text-white/30 sm:inline">•</span>
          <span>
            Loaded: <span className="text-white/90">{loadedSizeLabel}</span>
          </span>
        </div>
        <div
          className="relative flex h-4 items-center"
          onPointerMove={handleTimelinePointerMove}
          onPointerLeave={() => setTimelineHover(null)}
        >
          {timelineHover && (
            <div
              data-testid="timeline-hover-time"
              aria-hidden="true"
              className="pointer-events-none absolute bottom-full z-30 mb-2 -translate-x-1/2 rounded-md bg-black/95 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-white shadow-xl ring-1 ring-white/15"
              style={{
                left: `clamp(2rem, ${timelineHover.percent}%, calc(100% - 2rem))`,
              }}
            >
              {formatTime(timelineHover.time)}
            </div>
          )}
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step="0.05"
            value={Math.min(displayedTime, Math.max(duration, 0.01))}
            onChange={handleSeek}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={commitPendingSeek}
            onPointerCancel={() => {
              pendingSeekRef.current = null;
              setSeekPreview(null);
              setTimelineHover(null);
            }}
            onKeyUp={commitPendingSeek}
            onBlur={commitPendingSeek}
            className="relative z-10 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-transparent accent-red-600"
            style={{
              background: `linear-gradient(to right, #dc2626 0%, #dc2626 ${progressPercent}%, rgba(255,255,255,.38) ${progressPercent}%, rgba(255,255,255,.38) ${bufferedPercent}%, rgba(255,255,255,.16) ${bufferedPercent}%, rgba(255,255,255,.16) 100%)`,
            }}
            aria-label="Seek"
            aria-valuetext={`${formatTime(displayedTime)} of ${formatTime(duration)}`}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => void togglePlayback()}
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current" />}
            </button>
            <button
              type="button"
              onClick={() => skip(-10)}
              className="hidden rounded-lg p-2 hover:bg-white/10 sm:block"
              aria-label="Back 10 seconds"
            >
              <SkipBack className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => skip(10)}
              className="hidden rounded-lg p-2 hover:bg-white/10 sm:block"
              aria-label="Forward 10 seconds"
            >
              <SkipForward className="h-5 w-5" />
            </button>
            <div className="group/volume flex items-center">
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-lg p-2 hover:bg-white/10"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolume}
                className="hidden w-20 accent-red-600 sm:block"
                aria-label="Volume"
              />
            </div>
            <span className="whitespace-nowrap text-xs font-medium text-white/75 sm:text-sm">
              {formatTime(displayedTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <span className="hidden rounded-md bg-white/10 px-2 py-1 text-xs font-semibold sm:inline">
              {sourceResolution}
            </span>
            <button
              type="button"
              onClick={toggleSubtitles}
              className={`rounded-lg p-2 hover:bg-white/10 ${subtitlesEnabled ? 'text-red-400' : ''}`}
              aria-label="Toggle subtitles"
            >
              <Subtitles className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsOpen((value) => !value);
                revealControls();
              }}
              className={`rounded-lg p-2 hover:bg-white/10 ${settingsOpen ? 'text-red-400' : ''}`}
              aria-label="Player settings"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void togglePictureInPicture()}
              className="hidden rounded-lg p-2 hover:bg-white/10 sm:block"
              aria-label="Picture in picture"
            >
              <PictureInPicture2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label="Fullscreen"
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <div
          data-testid="player-settings"
          className="absolute bottom-20 right-3 top-20 z-40 flex w-[min(94vw,520px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111]/95 shadow-2xl backdrop-blur-xl sm:right-5"
          onMouseMove={revealControls}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">Player Settings</h2>
              <p className="text-sm text-white/55">Customize your viewing experience</p>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-xl border border-white/10 bg-white/5 p-2.5 hover:bg-white/10"
              aria-label="Close settings"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-5 border-b border-white/10 px-3">
            {([
              ['quality', ListVideo, 'Quality'],
              ['audio', AudioLines, 'Audio'],
              ['subtitles', Subtitles, 'Subtitles'],
              ['servers', Server, 'Servers'],
              ['speed', Gauge, 'Speed'],
            ] as const).map(([tab, Icon, label]) => (
              <button
                key={tab}
                type="button"
                data-testid={`settings-tab-${tab}`}
                aria-pressed={settingsTab === tab}
                onClick={() => setSettingsTab(tab)}
                className={`relative flex items-center justify-center gap-2 px-2 py-4 text-xs font-semibold sm:text-sm ${
                  settingsTab === tab ? 'text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
                {settingsTab === tab && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-red-500" />}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            <div
              data-testid="settings-file-information"
              className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-4 sm:grid-cols-2"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/15 p-2 text-blue-300">
                  <HardDriveDownload className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-white/45">Episode file size</div>
                  <div className="truncate font-semibold text-white">{episodeSizeLabel}</div>
                </div>
              </div>
              <div className="min-w-0 sm:border-l sm:border-white/10 sm:pl-4">
                <div className="text-xs text-white/45">Loaded in player</div>
                <div className="truncate font-semibold text-white">{loadedSizeLabel}</div>
              </div>
            </div>

            {settingsTab === 'quality' &&
              qualityOptions.map(({ source, index, resolution }) => {
                const selected = sourceResolution === resolution;
                return (
                  <button
                    key={resolution}
                    type="button"
                    onClick={() => {
                      if (selected) {
                        setSettingsOpen(false);
                        return;
                      }
                      switchSource(index);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border-l-2 px-4 py-4 text-left ${
                      selected
                        ? 'border-red-500 bg-red-950/55'
                        : 'border-white/25 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{resolution}</div>
                      <div className="mt-0.5 text-xs text-white/50">{getServerLabel(source)}</div>
                      <div className="mt-1 text-xs text-white/60">
                        File size: {selected ? episodeSizeLabel : sourceFileSizeLabel(source)}
                      </div>
                    </div>
                    {selected && <Check className="h-5 w-5 text-red-400" />}
                  </button>
                );
              })}

            {settingsTab === 'audio' && (
              <>
                {audioTracks.length === 0 && (
                  <div
                    data-testid="no-audio-tracks"
                    className="rounded-xl bg-white/5 px-4 py-5 text-sm text-white/55"
                  >
                    This stream does not expose alternate audio tracks.
                  </div>
                )}
                {audioTracks.map((track, index) => {
                  const selected = index === activeAudioTrack;
                  return (
                    <button
                      key={`${track.groupId}-${track.name}-${track.lang || index}`}
                      type="button"
                      data-testid={`audio-track-${index}`}
                      data-language={track.lang || ''}
                      aria-pressed={selected}
                      onClick={() => selectAudioTrack(index)}
                      className={`flex w-full items-center justify-between rounded-xl border-l-2 px-4 py-4 text-left ${
                        selected
                          ? 'border-red-500 bg-red-950/55'
                          : 'border-white/25 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {trackLabel(track, `Audio ${index + 1}`)}
                        </div>
                        <div className="mt-0.5 text-xs text-white/50">
                          {trackDetails(track)}
                        </div>
                      </div>
                      {selected && <Check className="h-5 w-5 shrink-0 text-red-400" />}
                    </button>
                  );
                })}
              </>
            )}

            {settingsTab === 'servers' &&
              availableSources.map((source, index) => {
                const selected = index === activeSourceIndex;
                return (
                  <button
                    key={`${source.url}-${index}`}
                    type="button"
                    onClick={() => switchSource(index)}
                    className={`flex w-full items-center justify-between rounded-xl border-l-2 px-4 py-4 text-left ${
                      selected
                        ? 'border-red-500 bg-red-950/55'
                        : 'border-white/25 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{getServerLabel(source)}</div>
                      <div className="mt-0.5 text-xs text-white/50">{getResolution(source)} · {source.status || 'available'}</div>
                      <div className="mt-1 text-xs text-white/70">
                        File size: {selected ? episodeSizeLabel : sourceFileSizeLabel(source)}
                      </div>
                      {selected && (
                        <div className="mt-0.5 text-xs text-white/50">Loaded: {loadedSizeLabel}</div>
                      )}
                    </div>
                    {selected && <Check className="h-5 w-5 shrink-0 text-red-400" />}
                  </button>
                );
              })}

            {settingsTab === 'subtitles' && (
              <>
                <button
                  type="button"
                  data-testid="subtitle-off"
                  aria-pressed={subtitleSelection.kind === 'off'}
                  onClick={selectSubtitlesOff}
                  className={`flex w-full items-center justify-between rounded-xl border-l-2 px-4 py-4 ${
                    subtitleSelection.kind === 'off'
                      ? 'border-red-500 bg-red-950/55'
                      : 'border-white/25 bg-white/5'
                  }`}
                >
                  <span className="font-semibold">Off</span>
                  {subtitleSelection.kind === 'off' && <Check className="h-5 w-5 text-red-400" />}
                </button>
                {subtitleTracks.length === 0 && (
                  <div
                    data-testid="no-built-in-subtitles"
                    className="rounded-xl bg-white/5 px-4 py-4 text-sm text-white/55"
                  >
                    No built-in subtitles are exposed by this stream.
                  </div>
                )}
                {subtitleTracks.map((track, index) => {
                  const selected =
                    subtitleSelection.kind === 'hls' &&
                    subtitleSelection.index === index;
                  return (
                    <button
                      key={`${track.groupId}-${track.name}-${track.lang || index}`}
                      type="button"
                      data-testid={`subtitle-track-${index}`}
                      data-language={track.lang || ''}
                      aria-pressed={selected}
                      onClick={() => selectBuiltInSubtitle(index)}
                      className={`flex w-full items-center justify-between rounded-xl border-l-2 px-4 py-4 text-left ${
                        selected
                          ? 'border-red-500 bg-red-950/55'
                          : 'border-white/25 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {trackLabel(track, `Subtitle ${index + 1}`)}
                        </div>
                        <div className="mt-0.5 text-xs text-white/50">
                          {trackDetails(track)} · Built-in
                        </div>
                      </div>
                      {selected && <Check className="h-5 w-5 shrink-0 text-red-400" />}
                    </button>
                  );
                })}
                {subtitleUrl && (
                  <button
                    type="button"
                    data-testid="subtitle-upload"
                    aria-pressed={subtitleSelection.kind === 'upload'}
                    onClick={selectUploadedSubtitle}
                    className={`flex w-full items-center justify-between rounded-xl border-l-2 px-4 py-4 text-left ${
                      subtitleSelection.kind === 'upload'
                        ? 'border-red-500 bg-red-950/55'
                        : 'border-white/25 bg-white/5'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{subtitleLabel}</div>
                      <div className="text-xs text-white/50">Uploaded subtitle</div>
                    </div>
                    {subtitleSelection.kind === 'upload' && <Check className="h-5 w-5 text-red-400" />}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="subtitle-upload-file"
                  onClick={() => uploadRef.current?.click()}
                  className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-4 py-4 text-left hover:bg-white/10"
                >
                  <Upload className="h-5 w-5" />
                  <div>
                    <div className="font-semibold">Upload subtitles</div>
                    <div className="text-xs text-white/50">WebVTT or SRT</div>
                  </div>
                </button>
                <input
                  ref={uploadRef}
                  type="file"
                  accept=".vtt,.srt,text/vtt,application/x-subrip"
                  className="hidden"
                  onChange={(event) => void handleSubtitleUpload(event)}
                />
              </>
            )}

            {settingsTab === 'speed' &&
              PLAYBACK_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => selectSpeed(speed)}
                  className={`flex w-full items-center justify-between rounded-xl border-l-2 px-4 py-4 ${
                    playbackRate === speed
                      ? 'border-red-500 bg-red-950/55'
                      : 'border-white/25 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className="font-semibold">{speed === 1 ? '1x (Normal)' : `${speed}x`}</span>
                  {playbackRate === speed && <span className="h-2.5 w-2.5 rounded-full bg-red-500" />}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
