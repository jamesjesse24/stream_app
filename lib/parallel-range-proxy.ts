import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

const LOOPBACK_HOST = '127.0.0.1';
const BLOCK_SIZE_BYTES = 1024 * 1024;
const MAX_UPSTREAM_CONCURRENCY = 6;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const UPSTREAM_BLOCK_TIMEOUT_MS = 12 * 1000;
const UPSTREAM_BLOCK_ATTEMPTS = 3;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_SOURCE_URL_LENGTH = 16 * 1024;
const MAX_USER_AGENT_LENGTH = 512;

interface RegisteredSource {
  id: string;
  sourceUrl: string;
  contentLength: number;
  userAgent: string;
  abortController: AbortController;
}

interface CacheEntry {
  sourceUrl: string;
  contentLength: number;
  data: Buffer;
}

interface InFlightBlock {
  controller: AbortController;
  consumers: Set<symbol>;
  promise: Promise<Buffer>;
  settled: boolean;
}

interface BlockLease {
  promise: Promise<Buffer>;
  release: () => void;
}

interface UpstreamSlotWaiter {
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  handleAbort: () => void;
}

interface ParallelRangeProxyStore {
  sources: Map<string, RegisteredSource>;
  server: Server | null;
  port: number | null;
  listenPromise: Promise<number> | null;
  cache: Map<string, CacheEntry>;
  cacheBytes: number;
  inFlight: Map<string, InFlightBlock>;
  activeUpstreamRequests: number;
  upstreamQueue: UpstreamSlotWaiter[];
}

interface ParsedRange {
  start: number;
  end: number;
  partial: boolean;
}

class ProxyHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ProxyHttpError';
  }
}

class UpstreamRangeError extends Error {
  constructor() {
    super('Upstream range request failed');
    this.name = 'UpstreamRangeError';
  }
}

const globalWithParallelRangeProxy = globalThis as typeof globalThis & {
  __uhdParallelRangeProxyStore?: ParallelRangeProxyStore;
};

const proxyStore =
  globalWithParallelRangeProxy.__uhdParallelRangeProxyStore ??
  (globalWithParallelRangeProxy.__uhdParallelRangeProxyStore = {
    sources: new Map<string, RegisteredSource>(),
    server: null,
    port: null,
    listenPromise: null,
    cache: new Map<string, CacheEntry>(),
    cacheBytes: 0,
    inFlight: new Map<string, InFlightBlock>(),
    activeUpstreamRequests: 0,
    upstreamQueue: [],
  });

export async function registerParallelRangeSource(
  id: string,
  sourceUrl: string,
  contentLength: number,
  userAgent: string,
): Promise<string> {
  assertValidSourceId(id);
  const normalizedUrl = validateSourceUrl(sourceUrl);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error('Parallel range source length must be a positive safe integer');
  }
  if (
    typeof userAgent !== 'string' ||
    userAgent.length === 0 ||
    userAgent.length > MAX_USER_AGENT_LENGTH ||
    !/^[\x20-\x7e]+$/.test(userAgent)
  ) {
    throw new Error('Parallel range source user agent is invalid');
  }

  const port = await ensureProxyServer();
  const previous = proxyStore.sources.get(id);
  if (previous) {
    previous.abortController.abort();
    proxyStore.sources.delete(id);
  }

  proxyStore.sources.set(id, {
    id,
    sourceUrl: normalizedUrl,
    contentLength,
    userAgent,
    abortController: new AbortController(),
  });
  if (previous) {
    // Preserve warmed blocks when an HMR reload registers the same source
    // again, while still purging data belonging only to a replaced URL.
    purgeUnusedSourceCache(previous.sourceUrl, previous.contentLength);
  }

  return `http://${LOOPBACK_HOST}:${port}/${id}`;
}

export function unregisterParallelRangeSource(id: string): void {
  if (!SOURCE_ID_PATTERN.test(id)) return;

  const source = proxyStore.sources.get(id);
  if (!source) return;

  proxyStore.sources.delete(id);
  source.abortController.abort();
  purgeUnusedSourceCache(source.sourceUrl, source.contentLength);
}

function assertValidSourceId(id: string): void {
  if (!SOURCE_ID_PATTERN.test(id)) {
    throw new Error('Parallel range source id is invalid');
  }
}

function validateSourceUrl(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_URL_LENGTH) {
    throw new Error('Parallel range source URL is invalid');
  }

  let source: URL;
  try {
    source = new URL(value);
  } catch {
    throw new Error('Parallel range source URL is invalid');
  }

  if (
    (source.protocol !== 'http:' && source.protocol !== 'https:') ||
    source.username ||
    source.password
  ) {
    throw new Error('Parallel range source URL is invalid');
  }
  return source.toString();
}

async function ensureProxyServer(): Promise<number> {
  if (proxyStore.server?.listening && proxyStore.port !== null) {
    return proxyStore.port;
  }
  if (proxyStore.listenPromise) return proxyStore.listenPromise;

  const server = createServer((request, response) => {
    void handleProxyRequest(request, response).catch((error: unknown) => {
      sendSafeError(request, response, error);
    });
  });
  proxyStore.server = server;
  server.on('clientError', (_error, socket) => {
    if (!socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
  });
  // Keep an error listener installed after startup so an unusual server-level
  // error cannot become an uncaught EventEmitter exception.
  server.on('error', () => undefined);
  server.on('close', () => {
    if (proxyStore.server === server) {
      proxyStore.server = null;
      proxyStore.port = null;
      proxyStore.listenPromise = null;
    }
  });

  const listenPromise = new Promise<number>((resolve, reject) => {
    const handleListenError = () => {
      reject(new Error('Could not start the parallel range proxy'));
    };
    server.once('error', handleListenError);
    server.listen(0, LOOPBACK_HOST, () => {
      server.removeListener('error', handleListenError);
      const address = server.address() as AddressInfo | null;
      if (!address || typeof address.port !== 'number') {
        reject(new Error('Parallel range proxy did not expose a TCP port'));
        return;
      }
      proxyStore.port = address.port;
      server.unref();
      resolve(address.port);
    });
  });
  proxyStore.listenPromise = listenPromise;

  try {
    return await listenPromise;
  } catch (error) {
    if (proxyStore.server === server) {
      proxyStore.server = null;
      proxyStore.port = null;
    }
    try {
      server.close();
    } catch {
      // The listening failure is the useful error to report.
    }
    throw error;
  } finally {
    if (proxyStore.listenPromise === listenPromise) {
      proxyStore.listenPromise = null;
    }
  }
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const remoteAddress = request.socket.remoteAddress;
  if (remoteAddress !== LOOPBACK_HOST && remoteAddress !== `::ffff:${LOOPBACK_HOST}`) {
    throw new ProxyHttpError(403, 'Forbidden');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new ProxyHttpError(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  const id = parseRequestId(request.url);
  const source = proxyStore.sources.get(id);
  if (!source) throw new ProxyHttpError(404, 'Source Not Found');

  const parsedRange = parseRangeHeader(request.headers.range, source.contentLength);
  response.statusCode = parsedRange.partial ? 206 : 200;
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', 'application/octet-stream');
  response.setHeader(
    'Content-Length',
    String(parsedRange.end - parsedRange.start + 1),
  );
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (parsedRange.partial) {
    response.setHeader(
      'Content-Range',
      `bytes ${parsedRange.start}-${parsedRange.end}/${source.contentLength}`,
    );
  }

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const requestController = new AbortController();
  const abortRequest = () => requestController.abort();
  request.once('aborted', abortRequest);
  response.once('close', abortRequest);
  source.abortController.signal.addEventListener('abort', abortRequest, {
    once: true,
  });

  try {
    response.flushHeaders();
    await streamRangeInOrder(source, parsedRange, response, requestController.signal);
    if (!requestController.signal.aborted && !response.destroyed) response.end();
  } finally {
    request.removeListener('aborted', abortRequest);
    response.removeListener('close', abortRequest);
    source.abortController.signal.removeEventListener('abort', abortRequest);
  }
}

function parseRequestId(rawUrl: string | undefined): string {
  if (!rawUrl || rawUrl.includes('?') || rawUrl.includes('#')) {
    throw new ProxyHttpError(400, 'Bad Request');
  }
  const match = /^\/([A-Za-z0-9_-]{16,128})$/.exec(rawUrl);
  if (!match || !SOURCE_ID_PATTERN.test(match[1])) {
    throw new ProxyHttpError(400, 'Bad Request');
  }
  return match[1];
}

function parseRangeHeader(
  header: string | undefined,
  contentLength: number,
): ParsedRange {
  if (header === undefined) {
    return { start: 0, end: contentLength - 1, partial: false };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    throw rangeNotSatisfiable(contentLength);
  }

  if (match[1] === '') {
    const suffixLength = parseSafeDecimal(match[2]);
    if (suffixLength === null || suffixLength <= 0) {
      throw rangeNotSatisfiable(contentLength);
    }
    return {
      start: Math.max(0, contentLength - suffixLength),
      end: contentLength - 1,
      partial: true,
    };
  }

  const start = parseSafeDecimal(match[1]);
  const requestedEnd = match[2] === '' ? contentLength - 1 : parseSafeDecimal(match[2]);
  if (
    start === null ||
    requestedEnd === null ||
    start >= contentLength ||
    requestedEnd < start
  ) {
    throw rangeNotSatisfiable(contentLength);
  }
  return {
    start,
    end: Math.min(requestedEnd, contentLength - 1),
    partial: true,
  };
}

function parseSafeDecimal(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rangeNotSatisfiable(contentLength: number): ProxyHttpError {
  return new ProxyHttpError(416, 'Range Not Satisfiable', {
    'Content-Range': `bytes */${contentLength}`,
  });
}

async function streamRangeInOrder(
  source: RegisteredSource,
  range: ParsedRange,
  response: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const firstBlockIndex = Math.floor(range.start / BLOCK_SIZE_BYTES);
  const lastBlockIndex = Math.floor(range.end / BLOCK_SIZE_BYTES);
  const pending = new Map<number, BlockLease>();
  let nextBlockIndex = firstBlockIndex;

  const fillWindow = () => {
    while (
      !signal.aborted &&
      pending.size < MAX_UPSTREAM_CONCURRENCY &&
      nextBlockIndex <= lastBlockIndex
    ) {
      pending.set(nextBlockIndex, acquireBlock(source, nextBlockIndex, signal));
      nextBlockIndex += 1;
    }
  };

  fillWindow();
  try {
    for (let blockIndex = firstBlockIndex; blockIndex <= lastBlockIndex; blockIndex += 1) {
      if (signal.aborted) throw createAbortError();
      const lease = pending.get(blockIndex);
      if (!lease) throw new UpstreamRangeError();

      let block: Buffer;
      try {
        block = await lease.promise;
      } finally {
        lease.release();
        pending.delete(blockIndex);
      }

      const blockStart = blockIndex * BLOCK_SIZE_BYTES;
      const sliceStart = Math.max(range.start, blockStart) - blockStart;
      const sliceEndExclusive = Math.min(range.end + 1, blockStart + block.length) - blockStart;
      if (sliceStart < 0 || sliceEndExclusive <= sliceStart || sliceEndExclusive > block.length) {
        throw new UpstreamRangeError();
      }

      await writeWithBackpressure(
        response,
        block.subarray(sliceStart, sliceEndExclusive),
        signal,
      );
      fillWindow();
    }
  } finally {
    for (const lease of Array.from(pending.values())) lease.release();
    pending.clear();
  }
}

function acquireBlock(
  source: RegisteredSource,
  blockIndex: number,
  downstreamSignal: AbortSignal,
): BlockLease {
  if (downstreamSignal.aborted) {
    return {
      promise: Promise.reject(createAbortError()),
      release: () => undefined,
    };
  }

  const key = getBlockKey(source, blockIndex);
  const cached = getCachedBlock(key);
  if (cached) {
    return { promise: Promise.resolve(cached), release: () => undefined };
  }

  let inFlight = proxyStore.inFlight.get(key);
  if (inFlight && (inFlight.settled || inFlight.controller.signal.aborted)) {
    if (proxyStore.inFlight.get(key) === inFlight) {
      proxyStore.inFlight.delete(key);
    }
    inFlight = undefined;
  }
  if (!inFlight) {
    const controller = new AbortController();
    inFlight = {
      controller,
      consumers: new Set<symbol>(),
      promise: Promise.resolve(Buffer.alloc(0)),
      settled: false,
    };
    proxyStore.inFlight.set(key, inFlight);
    const current = inFlight;
    current.promise = fetchAlignedBlock(source, blockIndex, controller.signal)
      .then((data) => {
        if (current.consumers.size > 0) putCachedBlock(key, source, data);
        return data;
      })
      .finally(() => {
        current.settled = true;
        if (proxyStore.inFlight.get(key) === current) {
          proxyStore.inFlight.delete(key);
        }
      });
    // A downstream can disconnect before its prefetched promise is awaited.
    // Attach a rejection handler immediately so that cancellation stays quiet.
    void current.promise.catch(() => undefined);
  }

  const token = Symbol('parallel-range-consumer');
  inFlight.consumers.add(token);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    downstreamSignal.removeEventListener('abort', release);
    inFlight?.consumers.delete(token);
    if (inFlight && inFlight.consumers.size === 0 && !inFlight.settled) {
      inFlight.controller.abort();
    }
  };
  downstreamSignal.addEventListener('abort', release, { once: true });
  if (downstreamSignal.aborted) release();

  return { promise: inFlight.promise, release };
}

async function fetchAlignedBlock(
  source: RegisteredSource,
  blockIndex: number,
  signal: AbortSignal,
): Promise<Buffer> {
  for (let attempt = 0; attempt < UPSTREAM_BLOCK_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw createAbortError();
    try {
      return await fetchAlignedBlockAttempt(source, blockIndex, signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw createAbortError();
      if (attempt === UPSTREAM_BLOCK_ATTEMPTS - 1) {
        throw new UpstreamRangeError();
      }
      await abortableDelay(250 * 2 ** attempt, signal);
    }
  }
  throw new UpstreamRangeError();
}

async function fetchAlignedBlockAttempt(
  source: RegisteredSource,
  blockIndex: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const releaseSlot = await acquireUpstreamSlot(signal);
  const blockStart = blockIndex * BLOCK_SIZE_BYTES;
  const blockLength = Math.min(BLOCK_SIZE_BYTES, source.contentLength - blockStart);
  if (!Number.isSafeInteger(blockStart) || blockStart < 0 || blockLength <= 0) {
    releaseSlot();
    throw new UpstreamRangeError();
  }
  const blockEnd = blockStart + blockLength - 1;
  const controller = new AbortController();
  const handleAbort = () => controller.abort();
  signal.addEventListener('abort', handleAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
  }, UPSTREAM_BLOCK_TIMEOUT_MS);
  timeout.unref();
  if (signal.aborted) handleAbort();

  try {
    const response = await fetch(source.sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Range: `bytes=${blockStart}-${blockEnd}`,
        'User-Agent': source.userAgent,
        'Accept-Encoding': 'identity',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    const contentRange = parseUpstreamContentRange(
      response.headers.get('content-range'),
    );
    const declaredLength = parseSafeDecimal(
      response.headers.get('content-length') ?? '',
    );
    const contentEncoding = response.headers.get('content-encoding');
    if (
      response.status !== 206 ||
      !contentRange ||
      contentRange.start !== blockStart ||
      contentRange.end !== blockEnd ||
      contentRange.total !== source.contentLength ||
      declaredLength !== blockLength ||
      (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity')
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new UpstreamRangeError();
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== blockLength) throw new UpstreamRangeError();
    return data;
  } catch (error) {
    if (signal.aborted) throw createAbortError();
    if (error instanceof UpstreamRangeError) throw error;
    throw new UpstreamRangeError();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', handleAbort);
    releaseSlot();
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    timer.unref();
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

function parseUpstreamContentRange(
  value: string | null,
): { start: number; end: number; total: number } | null {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const start = parseSafeDecimal(match[1]);
  const end = parseSafeDecimal(match[2]);
  const total = parseSafeDecimal(match[3]);
  return start === null || end === null || total === null
    ? null
    : { start, end, total };
}

function getBlockKey(source: RegisteredSource, blockIndex: number): string {
  return `${source.contentLength}\0${source.sourceUrl}\0${blockIndex}`;
}

function getCachedBlock(key: string): Buffer | null {
  const entry = proxyStore.cache.get(key);
  if (!entry) return null;
  proxyStore.cache.delete(key);
  proxyStore.cache.set(key, entry);
  return entry.data;
}

function putCachedBlock(
  key: string,
  source: RegisteredSource,
  data: Buffer,
): void {
  const previous = proxyStore.cache.get(key);
  if (previous) {
    proxyStore.cacheBytes -= previous.data.length;
    proxyStore.cache.delete(key);
  }
  proxyStore.cache.set(key, {
    sourceUrl: source.sourceUrl,
    contentLength: source.contentLength,
    data,
  });
  proxyStore.cacheBytes += data.length;

  while (proxyStore.cacheBytes > MAX_CACHE_BYTES && proxyStore.cache.size > 0) {
    const oldestKey = proxyStore.cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const oldest = proxyStore.cache.get(oldestKey);
    proxyStore.cache.delete(oldestKey);
    if (oldest) proxyStore.cacheBytes -= oldest.data.length;
  }
}

function purgeUnusedSourceCache(sourceUrl: string, contentLength: number): void {
  const stillRegistered = Array.from(proxyStore.sources.values()).some(
    (source) =>
      source.sourceUrl === sourceUrl && source.contentLength === contentLength,
  );
  if (stillRegistered) return;

  for (const [key, entry] of Array.from(proxyStore.cache.entries())) {
    if (entry.sourceUrl !== sourceUrl || entry.contentLength !== contentLength) continue;
    proxyStore.cache.delete(key);
    proxyStore.cacheBytes -= entry.data.length;
  }
  proxyStore.cacheBytes = Math.max(0, proxyStore.cacheBytes);
}

function acquireUpstreamSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(createAbortError());
  if (proxyStore.activeUpstreamRequests < MAX_UPSTREAM_CONCURRENCY) {
    proxyStore.activeUpstreamRequests += 1;
    return Promise.resolve(createUpstreamSlotRelease());
  }

  return new Promise<() => void>((resolve, reject) => {
    let waiter: UpstreamSlotWaiter;
    const handleAbort = () => {
      const index = proxyStore.upstreamQueue.indexOf(waiter);
      if (index >= 0) proxyStore.upstreamQueue.splice(index, 1);
      signal.removeEventListener('abort', handleAbort);
      reject(createAbortError());
    };
    waiter = { signal, resolve, reject, handleAbort };
    proxyStore.upstreamQueue.push(waiter);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

function createUpstreamSlotRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    proxyStore.activeUpstreamRequests = Math.max(
      0,
      proxyStore.activeUpstreamRequests - 1,
    );
    dispatchUpstreamQueue();
  };
}

function dispatchUpstreamQueue(): void {
  while (
    proxyStore.activeUpstreamRequests < MAX_UPSTREAM_CONCURRENCY &&
    proxyStore.upstreamQueue.length > 0
  ) {
    const waiter = proxyStore.upstreamQueue.shift();
    if (!waiter) return;
    waiter.signal.removeEventListener('abort', waiter.handleAbort);
    if (waiter.signal.aborted) {
      waiter.reject(createAbortError());
      continue;
    }
    proxyStore.activeUpstreamRequests += 1;
    waiter.resolve(createUpstreamSlotRelease());
  }
}

async function writeWithBackpressure(
  response: ServerResponse,
  data: Buffer,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || response.destroyed) throw createAbortError();
  if (response.write(data)) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.removeListener('drain', handleDrain);
      response.removeListener('close', handleClose);
      response.removeListener('error', handleError);
      signal.removeEventListener('abort', handleAbort);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(createAbortError());
    };
    const handleError = () => {
      cleanup();
      reject(new UpstreamRangeError());
    };
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    response.once('drain', handleDrain);
    response.once('close', handleClose);
    response.once('error', handleError);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted || response.destroyed) handleAbort();
  });
}

function sendSafeError(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
): void {
  if (isAbortError(error)) {
    if (!response.destroyed) response.destroy();
    return;
  }
  if (response.headersSent) {
    if (!response.destroyed) response.destroy();
    return;
  }

  const status = error instanceof ProxyHttpError ? error.status : 502;
  const message =
    error instanceof ProxyHttpError
      ? error.message
      : error instanceof UpstreamRangeError
        ? 'Upstream range request failed'
        : 'Range proxy request failed';
  const body = Buffer.from(`${message}\n`, 'utf8');
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', String(body.length));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (error instanceof ProxyHttpError) {
    for (const [name, value] of Object.entries(error.headers)) {
      response.setHeader(name, value);
    }
  }
  response.end(request.method === 'HEAD' ? undefined : body);
}

function createAbortError(): Error {
  const error = new Error('Parallel range request was aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
