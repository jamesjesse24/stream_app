// app/api/stream-info/route.ts
import { NextRequest, NextResponse } from 'next/server';

interface MP4Info {
  isValidMP4: boolean;
  moovFound: boolean;
  moovSize?: number;
  moovOffset?: number;
  fileSize?: number;
  supportsRanges?: boolean;
  contentType?: string;
}

function parseMP4Info(data: Uint8Array, maxBytes: number = 1048576): MP4Info {
  let offset = 0;
  let moovFound = false;
  let moovSize = 0;
  let moovOffset = 0;
  
  while (offset < data.length - 8 && offset < maxBytes) {
    try {
      // Read box size (4 bytes) and type (4 bytes)
      const size = new DataView(data.buffer, data.byteOffset + offset).getUint32(0);
      const type = new TextDecoder().decode(data.slice(offset + 4, offset + 8));
      
      if (type === 'moov') {
        moovFound = true;
        moovSize = size;
        moovOffset = offset;
        break;
      }
      
      if (size <= 8) break; // Invalid box size
      offset += size;
    } catch (error) {
      break;
    }
  }
  
  return {
    isValidMP4: moovFound,
    moovFound,
    moovSize: moovFound ? moovSize : undefined,
    moovOffset: moovFound ? moovOffset : undefined,
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

  try {
    // First, get file info with HEAD request
    const headResponse = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });

    const info: MP4Info = {
      isValidMP4: false,
      moovFound: false,
      fileSize: headResponse.headers.get('content-length') ? parseInt(headResponse.headers.get('content-length')!) : undefined,
      supportsRanges: headResponse.headers.get('accept-ranges') === 'bytes',
      contentType: headResponse.headers.get('content-type') || undefined,
    };

    // Download first 1MB to analyze MP4 structure
    const dataResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': 'bytes=0-1048575' // First 1MB
      },
      signal: AbortSignal.timeout(30000)
    });

    if (dataResponse.ok) {
      const buffer = await dataResponse.arrayBuffer();
      const data = new Uint8Array(buffer);
      const mp4Info = parseMP4Info(data);
      
      Object.assign(info, mp4Info);
    }

    return NextResponse.json({
      url,
      info,
      recommendations: generateRecommendations(info)
    });

  } catch (error) {
    return NextResponse.json({
      error: 'Failed to analyze stream',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

function generateRecommendations(info: MP4Info): string[] {
  const recommendations: string[] = [];
  
  if (!info.isValidMP4) {
    recommendations.push('File does not appear to be a valid MP4 - may need conversion');
  }
  
  if (!info.supportsRanges) {
    recommendations.push('Server does not support range requests - streaming may be less efficient');
  }
  
  if (info.moovFound && info.moovOffset && info.moovOffset > 1024 * 1024) {
    recommendations.push('MP4 metadata (moov atom) is located far into the file - consider re-encoding with faststart');
  }
  
  if (info.fileSize && info.fileSize > 100 * 1024 * 1024) {
    recommendations.push('Large file detected - progressive streaming is recommended');
  }
  
  if (info.isValidMP4 && info.supportsRanges) {
    recommendations.push('✓ File is optimally configured for streaming');
  }
  
  return recommendations;
}
