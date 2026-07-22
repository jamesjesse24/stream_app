import { NextRequest, NextResponse } from 'next/server';
import CloudflareBypass from '../../../../lib/cloudflare-bypass';

const cfBypass = new CloudflareBypass();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionToken, cookies, userAgent } = body;

    if (!sessionToken || !cookies || !Array.isArray(cookies)) {
      return NextResponse.json({
        error: 'Invalid request. Required: sessionToken, cookies (array)'
      }, { status: 400 });
    }

    cfBypass.setSession(sessionToken, cookies, userAgent);

    return NextResponse.json({
      success: true,
      message: 'Session cookies stored successfully',
      sessionToken,
      cookieCount: cookies.length
    });

  } catch (error) {
    console.error('Error setting session:', error);
    return NextResponse.json({
      error: 'Failed to store session'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionToken = searchParams.get('sessionToken');

  if (!sessionToken) {
    return NextResponse.json({
      error: 'sessionToken parameter required'
    }, { status: 400 });
  }

  const session = cfBypass.getSession(sessionToken);
  
  if (!session) {
    return NextResponse.json({
      exists: false,
      message: 'Session not found or expired'
    });
  }

  return NextResponse.json({
    exists: true,
    cookieCount: session.cookies.length,
    timestamp: session.timestamp,
    userAgent: session.userAgent
  });
}
