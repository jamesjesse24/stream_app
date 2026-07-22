# Google video playback smoke-test report

## Passed

- Playback routing test: Google download URL selects the byte-range proxy first.
- Fallback routing test: direct -> H.264 remux (`transcode=0`) -> full transcode (`transcode=1`).
- Range proxy test: forwards the browser's `Range` header and preserves `206`, `Content-Range`, and `Content-Length`.
- Range safety test: rejects an upstream server that ignores a range request instead of downloading the entire movie.
- Host validation test: rejects non-Google targets.
- Existing selected-server regression test.
- TypeScript syntax transpilation for the modified player and API routes.
- FFmpeg H.264 MKV-to-HLS video-copy remux test with playable transport-stream output.

## Not completed in this environment

- End-to-end browser playback against the supplied temporary Google URL. The execution environment could not resolve/fetch that host and the project dependencies were not available offline, so a full Next.js browser session could not be launched here.
