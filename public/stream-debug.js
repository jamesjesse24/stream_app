(() => {
  if (window.__STREAM_DEBUG_PROBE_ACTIVE__) return;
  window.__STREAM_DEBUG_PROBE_ACTIVE__ = true;

  const MAX_BODY_PREVIEW = 4000;
  const MAX_BUFFERED_RANGES = 8;
  const originalFetch = window.fetch.bind(window);
  const pendingEntries = [];
  let flushTimer = null;

  function errorDetails(error) {
    if (error instanceof Error) {
      return { name: error.name, message: error.message, stack: error.stack };
    }
    return { message: String(error) };
  }

  function summarizeUrl(value) {
    try {
      const parsed = new URL(value, window.location.href);
      const target = parsed.searchParams.get('url');
      const summary = { endpoint: `${parsed.origin}${parsed.pathname}` };

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

  function isStreamRequest(value) {
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

  function selectedHeaders(headers) {
    const output = {};
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

  function mediaRanges(ranges) {
    const result = [];
    const count = Math.min(ranges.length, MAX_BUFFERED_RANGES);
    for (let index = 0; index < count; index += 1) {
      result.push({
        start: Math.round(ranges.start(index) * 1000) / 1000,
        end: Math.round(ranges.end(index) * 1000) / 1000,
      });
    }
    return result;
  }

  function videoSnapshot(video) {
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
        ? { code: video.error.code, message: video.error.message }
        : null,
    };
  }

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingEntries.length === 0) return;
    const entries = pendingEntries.splice(0, 50);
    originalFetch('/api/stream-debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
      keepalive: true,
    }).catch(() => undefined);
    if (pendingEntries.length > 0) flushTimer = setTimeout(flush, 100);
  }

  function emit(event, data) {
    const entry = {
      time: new Date().toISOString(),
      event,
      ...(data === undefined ? {} : { data }),
    };
    console.debug(`[stream-debug] ${event}`, data === undefined ? '' : data);
    pendingEntries.push(entry);
    if (!flushTimer) flushTimer = setTimeout(flush, 100);
  }

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  window.fetch = async function streamDebugFetch(input, init) {
    const url = requestUrl(input);
    if (!isStreamRequest(url)) return originalFetch(input, init);

    const startedAt = performance.now();
    emit('fetch:start', {
      ...summarizeUrl(url),
      method: (init && init.method) || (input instanceof Request ? input.method : 'GET'),
      range:
        new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined)).get(
          'range',
        ) || null,
    });

    try {
      const response = await originalFetch(input, init);
      emit('fetch:response', {
        ...summarizeUrl(url),
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Math.round(performance.now() - startedAt),
        headers: selectedHeaders(response.headers),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || contentType.includes('application/json') || contentType.includes('mpegurl')) {
        response
          .clone()
          .text()
          .then((body) =>
            emit('fetch:body', {
              ...summarizeUrl(url),
              status: response.status,
              body: body.slice(0, MAX_BODY_PREVIEW),
            }),
          )
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

  const xhrMetadata = new WeakMap();
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function streamDebugOpen(method, url, ...rest) {
    xhrMetadata.set(this, { method, url: String(url), startedAt: 0 });
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function streamDebugSend(...args) {
    const metadata = xhrMetadata.get(this);
    if (!metadata || !isStreamRequest(metadata.url)) {
      return originalXhrSend.apply(this, args);
    }

    metadata.startedAt = performance.now();
    emit('xhr:start', {
      ...summarizeUrl(metadata.url),
      method: metadata.method,
    });

    let reported = false;
    const report = (event) => {
      if (reported && event === 'loadend') return;
      if (event === 'loadend') reported = true;

      let headers = {};
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

      if (this.status >= 400) {
        try {
          if (typeof this.responseText === 'string') {
            emit('xhr:body', {
              ...summarizeUrl(metadata.url),
              status: this.status,
              body: this.responseText.slice(0, MAX_BODY_PREVIEW),
            });
          }
        } catch {
          // Binary XHR responses do not expose responseText.
        }
      }
    };

    this.addEventListener('loadend', () => report('loadend'), { once: true });
    this.addEventListener('error', () => report('error'), { once: true });
    this.addEventListener('timeout', () => report('timeout'), { once: true });
    this.addEventListener('abort', () => report('abort'), { once: true });
    return originalXhrSend.apply(this, args);
  };

  const attachedVideos = new WeakSet();
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
  ];

  function attachVideo(video) {
    if (attachedVideos.has(video)) return;
    attachedVideos.add(video);
    for (const eventName of videoEvents) {
      video.addEventListener(eventName, () => emit(`video:${eventName}`, videoSnapshot(video)));
    }
    emit('video:attached', videoSnapshot(video));
  }

  document.querySelectorAll('video').forEach(attachVideo);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLVideoElement) attachVideo(node);
        node.querySelectorAll('video').forEach(attachVideo);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('error', (event) => {
    emit('window:error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: errorDetails(event.error),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    emit('window:unhandledrejection', errorDetails(event.reason));
  });

  emit('debug:enabled', {
    page: window.location.href,
    userAgent: navigator.userAgent,
  });
})();
