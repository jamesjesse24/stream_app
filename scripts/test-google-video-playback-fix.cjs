const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');

const root = path.resolve(__dirname, '..');

function loadPlaybackRouting() {
  const filename = path.join(root, 'src/components/EnhancedVideoPlayer.tsx');
  const source = fs.readFileSync(filename, 'utf8');
  const start = source.indexOf('function decodeSourceHint');
  const end = source.indexOf('function getBufferedEndForTime');
  assert.ok(start >= 0 && end > start, 'Could not extract playback routing helpers');
  const snippet = `${source.slice(start, end)}\nmodule.exports = { isGoogleVideoDownload, getPlaybackUrl };`;
  const javascript = ts.transpileModule(snippet, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    decodeURIComponent,
  });
  return module.exports;
}

function loadProxyRoute(fetchImpl) {
  const filename = path.join(root, 'app/api/google-video/route.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;

  class MockNextResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.headers = new Headers(init.headers);
    }
    static json(value, init = {}) {
      const headers = new Headers(init.headers);
      headers.set('content-type', 'application/json');
      const response = new MockNextResponse(JSON.stringify(value), {
        ...init,
        headers,
      });
      response.jsonValue = value;
      return response;
    }
  }

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(id) {
      if (id === 'next/server') {
        return { NextRequest: class {}, NextResponse: MockNextResponse };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    URL,
    Headers,
    Response,
    ReadableStream,
    AbortController,
    fetch: fetchImpl,
    console,
  };
  vm.runInNewContext(javascript, context, { filename });
  return module.exports;
}

function requestFor(target, range) {
  const local = new URL('http://localhost/api/google-video');
  local.searchParams.set('url', target);
  return {
    nextUrl: local,
    headers: new Headers(range ? { range, accept: 'video/*' } : { accept: 'video/*' }),
    signal: new AbortController().signal,
  };
}

(async () => {
  const { isGoogleVideoDownload, getPlaybackUrl } = loadPlaybackRouting();
  const googleUrl = 'https://video-downloads.googleusercontent.com/token-value';
  const source = { url: googleUrl, quality: '1080p - DriveSeed Instant' };

  assert.equal(isGoogleVideoDownload(googleUrl), true);
  const direct = getPlaybackUrl(source, 'direct');
  assert.equal(direct.strategy, 'google-direct');
  assert.match(direct.url, /^\/api\/google-video\?/);
  assert.equal(new URL(`http://local${direct.url}`).searchParams.get('url'), googleUrl);

  const remux = getPlaybackUrl(source, 'remux');
  assert.equal(remux.strategy, 'google-remux');
  assert.equal(new URL(`http://local${remux.url}`).searchParams.get('transcode'), '0');

  const transcode = getPlaybackUrl(source, 'transcode');
  assert.equal(transcode.strategy, 'google-transcode');
  assert.equal(new URL(`http://local${transcode.url}`).searchParams.get('transcode'), '1');

  const ordinary = getPlaybackUrl(
    { url: 'https://example.com/movie.mkv', quality: '1080p - DriveSeed Instant' },
    'direct',
  );
  assert.equal(ordinary.isHls, true);
  assert.equal(new URL(`http://local${ordinary.url}`).searchParams.get('transcode'), '1');

  let captured;
  const route = loadProxyRoute(async (target, init) => {
    captured = { target: String(target), init };
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': '4',
        'content-range': 'bytes 0-3/1000',
        'content-type': 'video/mp4',
      },
    });
  });
  const ranged = await route.GET(requestFor(googleUrl, 'bytes=0-3'));
  assert.equal(ranged.status, 206);
  assert.equal(captured.target, googleUrl);
  assert.equal(captured.init.headers.get('range'), 'bytes=0-3');
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-3/1000');
  assert.equal(ranged.headers.get('x-accel-buffering'), 'no');

  const ignoredRangeRoute = loadProxyRoute(async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    }),
  );
  const ignored = await ignoredRangeRoute.GET(requestFor(googleUrl, 'bytes=0-3'));
  assert.equal(ignored.status, 502);
  assert.match(ignored.body, /ignored the requested byte range/);

  const blocked = await route.GET(
    requestFor('https://example.com/not-google.mp4', 'bytes=0-3'),
  );
  assert.equal(blocked.status, 403);

  const vodSource = fs.readFileSync(path.join(root, 'app/api/playback-vod/route.ts'), 'utf8');
  assert.match(vodSource, /const shouldTranscode = transcodeValue !== '0'/);
  assert.match(vodSource, /getOrCreateSession\(sourceUrl, shouldTranscode\)/);

  console.log('PASS Google direct/range/remux/transcode routing tests');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
