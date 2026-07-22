// app/api/video-metadata/route.ts
import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';

async function tryFFprobe(url: string, options: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [...options, url]);
    
    let stdout = '';
    let stderr = '';

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFprobe failed with code ${code}: ${stderr}`));
      } else {
        try {
          const metadata = JSON.parse(stdout);
          resolve(metadata);
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error}`));
        }
      }
    });

    ffprobe.on('error', (error) => {
      reject(error);
    });
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  console.log('Getting metadata for URL:', url);

  // Try different FFprobe configurations in order of preference
  const probeConfigs = [
    // First try: High probe size with error tolerance
    [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-probesize', '50M',
      '-analyzeduration', '30M',
      '-fflags', '+genpts+igndts',
      '-err_detect', 'ignore_err',
      '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    ],
    // Second try: Medium probe size
    [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-probesize', '10M',
      '-analyzeduration', '10M',
      '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    ],
    // Third try: Basic probe (minimal options)
    [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-probesize', '1M',
      '-analyzeduration', '1M'
    ],
    // Fourth try: Ultra minimal (just format info)
    [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format'
    ]
  ];

  let metadata = null;
  let lastError: Error | null = null;

  // Try each configuration until one works
  for (const config of probeConfigs) {
    try {
      console.log('Trying FFprobe with config:', config.slice(0, 6), '...');
      metadata = await tryFFprobe(url, config);
      console.log('FFprobe succeeded with config');
      break;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('FFprobe config failed:', errorMessage);
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
  }

  if (!metadata) {
    console.error('All FFprobe attempts failed. Last error:', lastError?.message);
    return NextResponse.json({ 
      error: 'Failed to get video metadata',
      details: lastError?.message || 'Unknown error'
    }, { status: 500 });
  }

  try {
    // Safely extract streams with fallbacks
    const streams = metadata.streams || [];
    const format = metadata.format || {};
    
    const videoStreams = streams.filter((s: any) => s.codec_type === 'video');
    const audioStreams = streams.filter((s: any) => s.codec_type === 'audio');
    const subtitleStreams = streams.filter((s: any) => s.codec_type === 'subtitle');

    // Safe parsing with fallbacks
    const duration = parseFloat(format.duration) || 0;
    const bitrate = parseInt(format.bit_rate) || 0;
    const size = parseInt(format.size) || 0;

    const response = {
      duration,
      durationFormatted: formatDuration(duration),
      bitrate,
      size,
      format: format.format_name || 'unknown',
      video: videoStreams.map((stream: any) => ({
        index: stream.index || 0,
        codec: stream.codec_name || 'unknown',
        width: stream.width || 0,
        height: stream.height || 0,
        frameRate: safeEvalFrameRate(stream.r_frame_rate) || 0,
        bitrate: parseInt(stream.bit_rate) || 0
      })),
      audio: audioStreams.map((stream: any) => ({
        index: stream.index || 0,
        codec: stream.codec_name || 'unknown',
        language: stream.tags?.language || 'unknown',
        title: stream.tags?.title || `Audio ${stream.index || 0}`,
        channels: stream.channels || 0,
        sampleRate: parseInt(stream.sample_rate) || 0,
        bitrate: parseInt(stream.bit_rate) || 0
      })),
      subtitles: subtitleStreams.map((stream: any) => ({
        index: stream.index || 0,
        codec: stream.codec_name || 'unknown',
        language: stream.tags?.language || 'unknown',
        title: stream.tags?.title || `Subtitle ${stream.index || 0}`,
        forced: stream.disposition?.forced === 1,
        hearing_impaired: stream.disposition?.hearing_impaired === 1 || 
                        (stream.tags?.title && stream.tags.title.toLowerCase().includes('sdh'))
      }))
    };

    console.log('Metadata extracted successfully:', {
      duration: response.duration,
      videoStreams: response.video.length,
      audioStreams: response.audio.length,
      subtitleStreams: response.subtitles.length
    });

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error processing metadata:', errorMessage);
    return NextResponse.json({ 
      error: 'Failed to process video metadata',
      details: errorMessage
    }, { status: 500 });
  }
}

// Safe frame rate evaluation
function safeEvalFrameRate(frameRateStr: string): number {
  if (!frameRateStr || frameRateStr === '0/0') return 0;
  
  try {
    // Parse fraction like "24000/1001" or "30/1"
    if (frameRateStr.includes('/')) {
      const [num, den] = frameRateStr.split('/').map(Number);
      if (den && den !== 0) {
        return num / den;
      }
    }
    
    // Parse as decimal
    const rate = parseFloat(frameRateStr);
    return isNaN(rate) ? 0 : rate;
  } catch (error) {
    return 0;
  }
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
