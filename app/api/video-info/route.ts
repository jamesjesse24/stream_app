// app/api/video-info/route.ts
// Minimal fallback endpoint for getting basic video info when ffprobe fails
import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  console.log('Getting basic video info for:', url);

  try {
    // Try to get just the duration using ffprobe with minimal options
    const duration = await getVideoDuration(url);
    
    return NextResponse.json({
      duration,
      durationFormatted: formatDuration(duration),
      hasVideo: true, // Assume it's a video if we can get duration
      isPlayable: true
    });
  } catch (error) {
    console.error('Failed to get video info:', error);
    
    // Last resort: return minimal info that allows playback attempt
    return NextResponse.json({
      duration: 0,
      durationFormatted: '00:00:00',
      hasVideo: true,
      isPlayable: true
    });
  }
}

async function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      url
    ]);

    let output = '';
    let errorOutput = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 0 : duration);
      } else {
        reject(new Error(`FFprobe failed: ${errorOutput}`));
      }
    });

    ffprobe.on('error', (error) => {
      reject(error);
    });
  });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
