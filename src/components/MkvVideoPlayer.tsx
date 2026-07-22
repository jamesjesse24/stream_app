'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, Download, Play, Pause } from 'lucide-react';

interface MkvVideoPlayerProps {
  videoUrl: string;
  onError?: (error: string) => void;
  onSuccess?: () => void;
}

export function MkvVideoPlayer({
  videoUrl,
  onError,
  onSuccess,
}: MkvVideoPlayerProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const streamUrl = `/api/stream-mkv?url=${encodeURIComponent(videoUrl)}`;

  useEffect(() => {
    setError(null);
    setDebugInfo('');
    setIsLoading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (videoRef.current) {
      videoRef.current.src = streamUrl;
      videoRef.current.load();
    }
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [streamUrl]);

  const startLoadingTimer = () => {
    setIsLoading(true);
    setDebugInfo('Initializing MKV streaming (remux-optimized)...');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      const msg = 'Video loading timeout – large MKV file may require time for remuxing';
      setError(msg);
      setDebugInfo(msg);
      onError?.(msg);
    }, 60000); // Extended timeout for large MKV files
  };

  const clearLoadingTimer = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsLoading(false);
  };

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    clearLoadingTimer();
    const mediaError = e.currentTarget.error;
    let msg = 'Failed to load video';
    if (mediaError) {
      switch (mediaError.code) {
        case MediaError.MEDIA_ERR_ABORTED:     msg = 'Video loading was aborted'; break;
        case MediaError.MEDIA_ERR_NETWORK:     msg = 'Network error while loading video'; break;
        case MediaError.MEDIA_ERR_DECODE:      msg = 'Video format not supported or corrupted'; break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'Video source not supported or server error'; break;
        default:                               msg = mediaError.message || msg;
      }
    }
    setError(msg);
    setDebugInfo(`Error: ${msg}`);
    onError?.(msg);
  };

  const handleLoadedMetadata = () => {
    clearLoadingTimer();
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setDebugInfo(`MKV streaming ready • Duration: ${Math.round(videoRef.current.duration)}s • Remuxed to MP4`);
    }
    onSuccess?.();
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    setDebugInfo('Playing remuxed MKV stream');
  };

  const handlePause = () => {
    setIsPlaying(false);
    setDebugInfo('Paused');
  };

  const handleSeeking = () => {
    setDebugInfo('Seeking... (may restart stream for large seeks)');
  };

  const handleSeeked = () => {
    if (videoRef.current) {
      setDebugInfo(`Seeked to ${Math.round(videoRef.current.currentTime)}s`);
    }
  };

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (error) {
    return (
      <div className="flex flex-col items-center p-6 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
          Playback Error
        </h3>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-4">
          {error}
        </p>
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg max-w-md text-sm text-blue-800 dark:text-blue-200">
          💡 MKV streaming with server-side remuxing to MP4. Large files may take time to process. Seeking works best in early parts of the video.
        </div>
        <div className="flex gap-2">
          <Button onClick={() => videoRef.current?.load()} variant="outline" size="sm">
            Retry
          </Button>
          <Button
            onClick={() => window.open(videoUrl, '_blank')}
            variant="default"
            size="sm"
          >
            <Download className="h-4 w-4 mr-1" />
            Download Original
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <video
        ref={videoRef}
        className="w-full rounded-lg"
        controls
        preload="metadata"
        onLoadStart={startLoadingTimer}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleError}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeking={handleSeeking}
        onSeeked={handleSeeked}
        onWaiting={() => setDebugInfo('Buffering...')}
        onStalled={() => setDebugInfo('Stream stalled')}
        onProgress={() => {
          if (videoRef.current && videoRef.current.buffered.length > 0) {
            const buffered = videoRef.current.buffered.end(0);
            const total = videoRef.current.duration;
            if (total > 0) {
              const percent = Math.round((buffered / total) * 100);
              setDebugInfo(`Buffered: ${percent}% (${Math.round(buffered)}s)`);
            }
          }
        }}
      >
        <source
          src={streamUrl}
          type='video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        />
        Your browser does not support the video tag.
      </video>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg">
          <div className="text-center text-white">
            <div className="mb-2">Processing MKV file...</div>
            <div className="text-sm opacity-75">Server-side remuxing in progress</div>
          </div>
        </div>
      )}

      {/* Custom Controls Overlay */}
      <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 rounded p-2 text-white text-sm">
        <div className="flex items-center gap-4">
          <Button
            onClick={togglePlayPause}
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <div className="flex-1">
            {duration > 0 && (
              <div className="text-xs">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            )}
          </div>
          <div className="text-xs opacity-75">
            MKV→MP4
          </div>
        </div>
      </div>

      <div className="mt-2">
        {debugInfo && (
          <div className="text-xs text-gray-600 dark:text-gray-400 p-2 bg-gray-100 dark:bg-gray-800 rounded">
            Status: {debugInfo}
          </div>
        )}
        <div className="mt-2 flex gap-2 justify-center">
          <Button
            onClick={() => {
              setDebugInfo('Testing MKV remux endpoint...');
              fetch(streamUrl, { method: 'HEAD' })
                .then(r => {
                  const contentType = r.headers.get('content-type');
                  const acceptsRanges = r.headers.get('accept-ranges');
                  setDebugInfo(
                    `Endpoint: ${r.status} ${r.statusText} • Type: ${contentType} • Ranges: ${acceptsRanges || 'none'}`
                  );
                })
                .catch(err =>
                  setDebugInfo(`Endpoint test failed: ${err.message || err}`)
                );
            }}
            variant="outline"
            size="sm"
          >
            Test Endpoint
          </Button>
          <Button
            onClick={() => videoRef.current?.load()}
            variant="outline"
            size="sm"
          >
            Reload Video
          </Button>
        </div>
      </div>
    </div>
  );
}
