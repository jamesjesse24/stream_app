'use client';

import { useEffect } from 'react';

const STREAM_DEBUG_ENABLED = process.env.NEXT_PUBLIC_STREAM_DEBUG === '1';
const MAX_BODY_PREVIEW = 4000;
const MAX_BUFFERED_RANGES = 8;

type DebugEntry = {
  time: string;
  event: string;
  data?: unknown;
};

type XhrMetadata = {
  method: string;
  url: string;
  startedAt: number;
};

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function summarizeUrl(value: string): Record<string, unknown> {
  try {
    const parsed = new URL(value, window.location.href);
    const target = parsed.searchParams.get('url');
    const summary: Record<string, unknown> = {
      endpoint: `${parsed.origin}${parsed.pathname}`,
    };

    for (const name of ['transcode', 'session', 'asset']) {
      const parameter = parsed.searchParams.get(name);
      if (parameter !== null) summary[name] = parameter;
    }

    if (target) {
      try {
        const targetUrl = new URL(target);
        summary.target = {
          origin: targetUrl.origin,
          pathname:
            targetUrl.pathname.length > 180
              ? `${targetUrl.pathname.slice(0, 180)}…`
              : targetUrl.pathname,
          pathnameLength: targetUrl.pathname.length,
        };
      } catch {
        summary.target = target.length > 240 ? `${target.slice(0, 240)}…` : target;
      }
    } else if (!parsed.pathname.startsWith('/api/')) {
      summary.url = value.length > 300 ? `${value.slice(0, 300)}…` : value;
    }

    return summary;
  } catch {
    return { url: value.length > 300 ? `${value.slice(0, 300)}…` : value };
  }
}

function isStreamRequest(value: string): boolean {
  try {
    const parsed = new URL(value, window.location.href);
    return (
      parsed.pathname.startsWith('/api/google-video') ||
      parsed.pathname.startsWith('/api/playback-vod') ||
      /\.(?:m3u8|m4s|mp4|mkv|ts)(?:$|[?#])/i.test(parsed.pathname)
    );
  } catch {
    return /(?:google-video|playback-vod|\.m3u8|\.m4s|\.mp4|\.mkv|\.ts)/i.test(value);
  }
}

function selectedHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'x-accel-buffering',
    'x-vod-session',
    'x-vod-duration',
    'x-vod-video-codec',
  ]) {
    const value = headers.get(name);
    if (value !== null) output[name] = value;
  }
  return output;
}

function mediaRanges(ranges: TimeRanges): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  const count = Math.min(ranges.length, MAX_BUFFERED_RANGES);
  for (let index = 0; index < count; index += 1) {
    result.push({
      start: Math.round(ranges.start(index) * 1000) / 1000,
      end: Math.round(ranges.end(index) * 1000) / 1000,
    });
  }
  return result;
}

function videoSnapshot(video: HTMLVideoElement): Record<string, unknown> {
  return {
    currentSrc: video.currentSrc || video.src || null,
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : null,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    paused: video.paused,
    muted: video.muted,
    volume: video.volume,
    autoplay: video.autoplay,
    readyState: video.readyState,
    networkState: video.networkState,
    buffered: mediaRanges(video.buffered),
    seekable: mediaRanges(video.seekable),
    error: video.error
      ? {
          code: video.error.code,
          message: video.error.message,
        }
      : null,
  };
}

export function StreamDebugProbe() {
  useEffect(() => {
    if (!STREAM_DEBUG_ENABLED) return;

    const originalFetch = window.fetch.bind(window);
    const pendingEntries: DebugEntry[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pendingEntries.length === 0 || stopped) return;
      const entries = pendingEntries.splice(0, 50);
      void originalFetch('/api/stream-debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
        keepalive: true,
      }).catch(() => undefined);
      if (pendingEntries.length > 0) flushTimer = setTimeout(flush, 100);
    };

    const emit = (event: string, data?: unknown) => {
      const entry: DebugEntry = {
        time: new Date().toISOString(),
        event,
        ...(data === undefined ? {} : { data }),
      };
      console.debug(`[stream-debug] ${event}`, data ?? '');
      pendingEntries.push(entry);
      if (!flushTimer) flushTimer = setTimeout(flush, 100);
    };

    const requestUrl = (input: RequestInfo | URL): string => {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      return input.url;
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (!isStreamRequest(url)) return originalFetch(input, init);

      const startedAt = performance.now();
      emit('fetch:start', {
        ...summarizeUrl(url),
        method: init?.method || (input instanceof Request ? input.method : 'GET'),
        range:
          new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)).get(
            'range',
          ) || null,
      });

      try {
        const response = await originalFetch(input, init);
        const elapsedMs = Math.round(performance.now() - startedAt);
        const details = {
          ...summarizeUrl(url),
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          headers: selectedHeaders(response.headers),
        };
        emit('fetch:response', details);

        const contentType = response.headers.get('content-type') || '';
        if (
          !response.ok ||
          contentType.includes('application/json') ||
          contentType.includes('mpegurl')
        ) {
          void response
            .clone()
            .text()
            .then((body) => {
              emit('fetch:body', {
                ...summarizeUrl(url),
                status: response.status,
                body: body.slice(0, MAX_BODY_PREVIEW),
              });
            })
            .catch((error) => emit('fetch:body-error', errorDetails(error)));
        }

        return response;
      } catch (error) {
        emit('fetch:error', {
          ...summarizeUrl(url),
          elapsedMs: Math.round(performance.now() - startedAt),
          error: errorDetails(error),
        });
        throw error;
      }
    };

    const xhrMetadata = new WeakMap<XMLHttpRequest, XhrMetadata>();
    const xhrPrototype = XMLHttpRequest.prototype as XMLHttpRequest & {
      open: (...args: unknown[]) => unknown;
      send: (...args: unknown[]) => unknown;
    };
    const originalXhrOpen = xhrPrototype.open;
    const originalXhrSend = xhrPrototype.send;

    xhrPrototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      xhrMetadata.set(this, {
        method,
        url: String(url),
        startedAt: 0,
      });
      return originalXhrOpen.call(this, method, url, ...rest);
    };

    xhrPrototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
      const metadata = xhrMetadata.get(this);
      if (!metadata || !isStreamRequest(metadata.url)) {
        return originalXhrSend.apply(this, args);
      }

      metadata.startedAt = performance.now();
      emit('xhr:start', {
        ...summarizeUrl(metadata.url),
        method: metadata.method,
      });

      const report = (event: string) => {
        let headers: Record<string, string> = {};
        try {
          const parsedHeaders = new Headers();
          for (const line of this.getAllResponseHeaders().trim().split(/\r?\n/)) {
            const separator = line.indexOf(':');
            if (separator > 0) {
              parsedHeaders.append(line.slice(0, separator), line.slice(separator + 1).trim());
            }
          }
          headers = selectedHeaders(parsedHeaders);
        } catch {
          // Response headers are unavailable for some aborted requests.
        }

        emit(`xhr:${event}`, {
          ...summarizeUrl(metadata.url),
          method: metadata.method,
          status: this.status,
          statusText: this.statusText,
          responseURL: this.responseURL ? summarizeUrl(this.responseURL) : null,
          elapsedMs: Math.round(performance.now() - metadata.startedAt),
          headers,
        });

        if (this.status >= 400 && typeof this.responseText === 'string') {
          emit('xhr:body', {
            ...summarizeUrl(metadata.url),
            status: this.status,
            body: this.responseText.slice(0, MAX_BODY_PREVIEW),
          });
        }
      };

      this.addEventListener('loadend', () => report('loadend'), { once: true });
      this.addEventListener('error', () => report('error'), { once: true });
      this.addEventListener('timeout', () => report('timeout'), { once: true });
      this.addEventListener('abort', () => report('abort'), { once: true });
      return originalXhrSend.apply(this, args);
    };

    const videoCleanups = new Map<HTMLVideoElement, () => void>();
    const videoEvents = [
      'loadstart',
      'durationchange',
      'loadedmetadata',
      'loadeddata',
      'progress',
      'canplay',
      'canplaythrough',
      'play',
      'playing',
      'pause',
      'waiting',
      'stalled',
      'suspend',
      'seeking',
      'seeked',
      'emptied',
      'abort',
      'error',
      'ended',
    ] as const;

    const attachVideo = (video: HTMLVideoElement) => {
      if (videoCleanups.has(video)) return;
      const listeners = videoEvents.map((eventName) => {
        const listener = () => emit(`video:${eventName}`, videoSnapshot(video));
        video.addEventListener(eventName, listener);
        return { eventName, listener };
      });
      videoCleanups.set(video, () => {
        listeners.forEach(({ eventName, listener }) =>
          video.removeEventListener(eventName, listener),
        );
      });
      emit('video:attached', videoSnapshot(video));
    };

    document.querySelectorAll('video').forEach((video) => attachVideo(video));
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLVideoElement) attachVideo(node);
          node.querySelectorAll('video').forEach((video) => attachVideo(video));
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const handleWindowError = (event: ErrorEvent) => {
      emit('window:error', {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error: errorDetails(event.error),
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      emit('window:unhandledrejection', errorDetails(event.reason));
    };
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    emit('debug:enabled', {
      page: window.location.href,
      userAgent: navigator.userAgent,
    });

    return () => {
      stopped = true;
      window.fetch = originalFetch;
      xhrPrototype.open = originalXhrOpen;
      xhrPrototype.send = originalXhrSend;
      observer.disconnect();
      videoCleanups.forEach((cleanup) => cleanup());
      videoCleanups.clear();
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, []);

  return null;
}
