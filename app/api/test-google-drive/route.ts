// app/api/test-google-drive/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  console.log(`=== TESTING GOOGLE DRIVE URL ===`);
  console.log(`URL: ${url.substring(0, 100)}...`);

  // Enhanced headers for Google Drive compatibility
  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site'
  });

  try {
    // Test basic connectivity
    console.log('Testing basic HEAD request...');
    const headResponse = await fetch(url, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(30000)
    });

    console.log(`HEAD Response: ${headResponse.status} ${headResponse.statusText}`);
    console.log('Response headers:', Object.fromEntries(headResponse.headers.entries()));

    // Test range request capability
    console.log('Testing range request...');
    const rangeHeaders = new Headers(headers);
    rangeHeaders.set('Range', 'bytes=0-1023');
    
    const rangeResponse = await fetch(url, {
      headers: rangeHeaders,
      signal: AbortSignal.timeout(30000)
    });

    console.log(`Range Response: ${rangeResponse.status} ${rangeResponse.statusText}`);

    // Test small chunk read
    console.log('Testing small chunk read...');
    const chunkResponse = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30000)
    });

    if (chunkResponse.ok && chunkResponse.body) {
      const reader = chunkResponse.body.getReader();
      let bytesRead = 0;
      let chunks = 0;
      const startTime = Date.now();

      try {
        while (bytesRead < 1024 * 1024 && chunks < 10) { // Read up to 1MB or 10 chunks
          const { done, value } = await reader.read();
          if (done) break;
          
          bytesRead += value.length;
          chunks++;
          
          // Check read speed
          const elapsed = Date.now() - startTime;
          if (elapsed > 10000) break; // Stop after 10 seconds
        }
        
        reader.releaseLock();
        
        const elapsed = Date.now() - startTime;
        const speed = bytesRead / (elapsed / 1000); // bytes per second

        console.log(`Read ${bytesRead} bytes in ${chunks} chunks over ${elapsed}ms`);
        console.log(`Speed: ${(speed / 1024).toFixed(2)} KB/s`);

        return NextResponse.json({
          success: true,
          url: url.substring(0, 100) + '...',
          tests: {
            head: {
              status: headResponse.status,
              contentType: headResponse.headers.get('content-type'),
              contentLength: headResponse.headers.get('content-length'),
              acceptRanges: headResponse.headers.get('accept-ranges')
            },
            range: {
              status: rangeResponse.status,
              supportsRanges: rangeResponse.status === 206
            },
            streaming: {
              bytesRead,
              chunks,
              timeMs: elapsed,
              speedKBps: (speed / 1024).toFixed(2),
              isGood: speed > 50000 // 50KB/s minimum
            }
          },
          recommendations: generateRecommendations(headResponse, rangeResponse, speed)
        });

      } finally {
        try {
          reader.releaseLock();
        } catch (e) {
          // Already released
        }
      }
    }

    return NextResponse.json({
      success: false,
      error: 'Could not read stream',
      tests: {
        head: {
          status: headResponse.status,
          contentType: headResponse.headers.get('content-type'),
          contentLength: headResponse.headers.get('content-length')
        },
        range: {
          status: rangeResponse.status
        }
      }
    });

  } catch (error) {
    console.error('Google Drive test failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      url: url.substring(0, 100) + '...'
    }, { status: 500 });
  }
}

function generateRecommendations(headResponse: Response, rangeResponse: Response, speed: number): string[] {
  const recommendations = [];

  if (headResponse.status !== 200) {
    recommendations.push(`⚠️ HEAD request failed (${headResponse.status}). Check URL permissions.`);
  }

  if (rangeResponse.status !== 206) {
    recommendations.push('⚠️ Range requests not supported. Seeking may not work properly.');
  }

  if (speed < 50000) {
    recommendations.push('⚠️ Slow connection detected. Large files may timeout during transcoding.');
  }

  const contentLength = headResponse.headers.get('content-length');
  if (contentLength) {
    const sizeGB = parseInt(contentLength) / (1024 * 1024 * 1024);
    if (sizeGB > 2) {
      recommendations.push(`⚠️ Large file detected (${sizeGB.toFixed(1)}GB). Consider compressing or splitting.`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('✅ URL looks good for transcoding!');
  }

  return recommendations;
}
