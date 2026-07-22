// app/api/stream/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function HEAD(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const upstreamHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const upstream = await fetch(url, {
      method: 'HEAD',
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status });
    }

    const resHeaders = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control': 'public, max-age=3600',
    });

    // Forward content-length and other important headers
    ['content-length', 'last-modified', 'etag'].forEach(header => {
      const value = upstream.headers.get(header);
      if (value) resHeaders.set(header, value);
    });

    return new NextResponse(null, {
      status: 200,
      headers: resHeaders,
    });

  } catch (error) {
    console.error('HEAD request error:', error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new NextResponse(null, { status: 499 });
      }
      if (error.name === 'TimeoutError') {
        return new NextResponse(null, { status: 504 });
      }
    }
    
    return new NextResponse(null, { status: 500 });
  }
}

// Simple in-memory cache for MP4 metadata
const metadataCache = new Map<string, { moovAtom: Uint8Array; contentLength: number }>();

interface MP4ParseResult {
  moovAtom: Uint8Array | null;
  moovEnd: number;
  isValidMP4: boolean;
}

function parseMP4Metadata(data: Uint8Array, maxBytes: number = 1048576): MP4ParseResult {
  let offset = 0;
  let moovAtom: Uint8Array | null = null;
  let moovEnd = 0;
  
  while (offset < data.length - 8 && offset < maxBytes) {
    // Read box size (4 bytes) and type (4 bytes)
    const size = new DataView(data.buffer, data.byteOffset + offset).getUint32(0);
    const type = new TextDecoder().decode(data.slice(offset + 4, offset + 8));
    
    if (type === 'moov') {
      moovAtom = data.slice(offset, offset + size);
      moovEnd = offset + size;
      console.log(`Found moov atom: ${size} bytes at offset ${offset}`);
      break;
    }
    
    if (size <= 8) break; // Invalid box size
    offset += size;
  }
  
  return {
    moovAtom,
    moovEnd,
    isValidMP4: moovAtom !== null
  };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  const range = req.headers.get('range');
  const cacheKey = url;
  
  try {
    // First, check if we need to extract MP4 metadata
    let metadata = metadataCache.get(cacheKey);
    
    if (!metadata && range) {
      console.log('Extracting MP4 metadata for:', url);
      
      // Download first 1MB to extract moov atom
      const metadataHeaders = new Headers({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': 'bytes=0-1048575' // First 1MB
      });
      
      const metadataResponse = await fetch(url, {
        headers: metadataHeaders,
        // Remove timeout for metadata extraction
      });
      
      if (metadataResponse.ok) {
        const buffer = await metadataResponse.arrayBuffer();
        const data = new Uint8Array(buffer);
        const parseResult = parseMP4Metadata(data);
        
        if (parseResult.isValidMP4 && parseResult.moovAtom) {
          // Get total file size
          const headResponse = await fetch(url, { method: 'HEAD' });
          const contentLength = parseInt(headResponse.headers.get('content-length') || '0');
          
          metadata = {
            moovAtom: parseResult.moovAtom,
            contentLength
          };
          metadataCache.set(cacheKey, metadata);
          console.log(`Cached MP4 metadata: ${parseResult.moovAtom.length} bytes`);
        }
      }
    }

    // Now make the actual request
    const upstreamHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'video/*,*/*;q=0.9',
    });

    if (range) {
      upstreamHeaders.set('Range', range);
      console.log('Range request:', range);
    }

    const upstream = await fetch(url, {
      headers: upstreamHeaders,
      redirect: 'follow',
      // Remove aggressive timeout for large files
    });

    console.log('Upstream response:', upstream.status, upstream.statusText);

    if (!upstream.ok && upstream.status !== 206) {
      return new NextResponse(`Upstream error: ${upstream.statusText}`, {
        status: upstream.status,
      });
    }

    // If we requested a range but got 200, the server doesn't support ranges properly
    if (range && upstream.status === 200) {
      console.log('Server returned 200 for range request - may not support ranges properly');
      
      // Parse the range request
      const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : start + 1048576; // Default to 1MB chunk
        const requestedBytes = end - start + 1;
        
        console.log(`Requested range: ${start}-${end} (${requestedBytes} bytes)`);
        
        // Read only the requested amount from the stream
        const reader = upstream.body?.getReader();
        if (!reader) {
          return new NextResponse('No response body', { status: 500 });
        }

        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let skippedBytes = 0;

        try {
          // Skip bytes until we reach the start position
          while (skippedBytes < start) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const remainingSkip = start - skippedBytes;
            if (value.length <= remainingSkip) {
              skippedBytes += value.length;
            } else {
              // Partial skip, keep the remainder
              const keepBytes = value.length - remainingSkip;
              chunks.push(value.slice(remainingSkip));
              totalBytes += keepBytes;
              skippedBytes += remainingSkip;
              break;
            }
          }

          // Read the requested bytes
          while (totalBytes < requestedBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const remainingBytes = requestedBytes - totalBytes;
            if (value.length <= remainingBytes) {
              chunks.push(value);
              totalBytes += value.length;
            } else {
              chunks.push(value.slice(0, remainingBytes));
              totalBytes += remainingBytes;
              break;
            }
          }
        } finally {
          reader.releaseLock();
        }

        // Combine chunks
        let finalData: Uint8Array;
        
        if (metadata && metadata.moovAtom && start > 0) {
          // For range requests beyond the start, prepend the moov atom
          console.log(`Prepending ${metadata.moovAtom.length} bytes of MP4 metadata to chunk`);
          
          finalData = new Uint8Array(metadata.moovAtom.length + totalBytes);
          finalData.set(metadata.moovAtom, 0);
          
          let offset = metadata.moovAtom.length;
          for (const chunk of chunks) {
            finalData.set(chunk, offset);
            offset += chunk.length;
          }
          
          // Update headers to reflect the larger size
          const finalSize = finalData.length;
          const resHeaders = new Headers({
            'Accept-Ranges': 'bytes',
            'Content-Type': 'video/mp4',
            'Content-Length': finalSize.toString(),
            'Content-Range': `bytes ${start}-${start + totalBytes - 1}/${metadata.contentLength}`,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
            'Cache-Control': 'public, max-age=3600',
            'X-Enhanced-MP4': 'metadata-injected',
          });

          return new NextResponse(finalData, {
            status: 206,
            headers: resHeaders,
          });
        } else {
          // Normal case - just combine the chunks as-is
          const combinedArray = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            combinedArray.set(chunk, offset);
            offset += chunk.length;
          }
          
          finalData = combinedArray;
        }

        const resHeaders = new Headers({
          'Accept-Ranges': 'bytes',
          'Content-Type': 'video/mp4',
          'Content-Length': totalBytes.toString(),
          'Content-Range': `bytes ${start}-${start + totalBytes - 1}/*`,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
          'Cache-Control': 'public, max-age=3600',
        });

        return new NextResponse(finalData, {
          status: 206,
          headers: resHeaders,
        });
      }
    }

    // Create response headers
    const resHeaders = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4', // Force MP4 for browser compatibility
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control': 'public, max-age=3600',
    });

    // Forward important headers from upstream
    ['content-length', 'content-range'].forEach(header => {
      const value = upstream.headers.get(header);
      if (value) resHeaders.set(header, value);
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });

  } catch (error) {
    console.error('Stream error:', error);
    
    // Handle different error types
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request aborted', details: 'Stream was cancelled' },
          { status: 499 } // Client closed request
        );
      }
      
      if (error.name === 'TimeoutError') {
        return NextResponse.json(
          { error: 'Request timeout', details: 'Stream took too long to respond' },
          { status: 504 } // Gateway timeout
        );
      }
      
      if (error.message.includes('fetch')) {
        return NextResponse.json(
          { error: 'Network error', details: 'Failed to fetch from upstream source' },
          { status: 502 } // Bad gateway
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to stream video', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
