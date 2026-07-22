(() => {
  if (window.__STREAM_DIAGNOSE_WATCHER_ACTIVE__) return;
  window.__STREAM_DIAGNOSE_WATCHER_ACTIVE__ = true;

  const diagnosed = new Set();

  async function diagnoseCurrentSource() {
    try {
      const page = new URL(window.location.href);
      const source = page.searchParams.get('video');
      if (!source || diagnosed.has(source)) return;
      diagnosed.add(source);

      console.log('[stream-debug] Running automatic server-side source diagnostics…');
      const response = await fetch(`/api/stream-diagnose?url=${encodeURIComponent(source)}`, {
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null);
      console.log('[stream-debug] Source diagnostics result:', result);
    } catch (error) {
      console.error('[stream-debug] Automatic source diagnostics failed:', error);
    }
  }

  void diagnoseCurrentSource();
  setInterval(() => void diagnoseCurrentSource(), 1000);
})();
