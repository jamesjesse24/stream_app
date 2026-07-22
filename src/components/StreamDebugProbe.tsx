'use client';

import Script from 'next/script';

export function StreamDebugProbe() {
  if (process.env.NEXT_PUBLIC_STREAM_DEBUG !== '1') return null;

  return (
    <>
      <Script src="/stream-debug.js" strategy="afterInteractive" />
      <Script src="/stream-diagnose.js" strategy="afterInteractive" />
    </>
  );
}
