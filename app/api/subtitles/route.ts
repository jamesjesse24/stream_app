// app/api/subtitles/route.ts
import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const streamIndex = req.nextUrl.searchParams.get('stream');
  
  if (!url || !streamIndex) {
    return NextResponse.json({ error: 'Missing url or stream parameter' }, { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let isControllerClosed = false;
      
      const safeClose = () => {
        if (!isControllerClosed) {
          isControllerClosed = true;
          controller.close();
        }
      };

      const safeError = (err: Error) => {
        if (!isControllerClosed) {
          isControllerClosed = true;
          controller.error(err);
        }
      };

      // Extract subtitle using ffmpeg with enhanced parameters and safer mapping
      const ffmpegArgs = [
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        '-i', url,
        '-map', `0:s:${streamIndex}?`,  // Map specific subtitle stream with optional flag
        '-f', 'webvtt',                 // Output as WebVTT format
        '-c:s', 'webvtt',               // Use WebVTT codec
        '-loglevel', 'error',           // Reduce noise in logs
        'pipe:1'                        // Output to stdout
      ];

      console.log(`Extracting subtitle stream ${streamIndex} from: ${url.substring(0, 100)}...`);
      
      const ff = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      // Capture stderr for debugging
      let stderrOutput = '';
      ff.stderr.on('data', (data) => {
        stderrOutput += data.toString();
      });

      ff.on('error', (err) => {
        console.error('FFmpeg subtitle process error:', err);
        safeError(err);
      });

      ff.on('exit', (code) => {
        if (code !== 0) {
          console.error(`FFmpeg subtitle extraction failed with code ${code}`);
          console.error(`FFmpeg subtitle stderr:`, stderrOutput);
          safeError(new Error(`Subtitle extraction failed: ${stderrOutput.split('\n').slice(-2).join(' ')}`));
        } else {
          console.log(`Subtitle extraction completed successfully`);
          safeClose();
        }
      });

      ff.stdout.on('data', (chunk) => {
        if (!isControllerClosed) {
          controller.enqueue(chunk);
        }
      });

      ff.stdout.on('end', () => {
        safeClose();
      });

      ff.stdout.on('error', (err) => {
        console.error('FFmpeg subtitle stdout error:', err);
        safeError(err instanceof Error ? err : new Error('FFmpeg subtitle stdout error'));
      });

      // Clean up if the client disconnects
      req.signal.addEventListener('abort', () => {
        ff.kill('SIGKILL');
        safeClose();
      });
    }
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/vtt',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
