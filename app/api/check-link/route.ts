import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      clearTimeout(timeoutId);
      const status = response.ok ? 'live' : 'dead';
      
      return NextResponse.json({ 
        url, 
        status,
        statusCode: response.status 
      });
    } catch (error) {
      return NextResponse.json({ 
        url, 
        status: 'dead',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } catch (error) {
    return NextResponse.json({ 
      error: 'Invalid request body' 
    }, { status: 400 });
  }
}
