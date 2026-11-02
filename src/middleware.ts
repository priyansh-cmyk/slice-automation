import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');

  if (origin) {
    let originHostname: string;
    try {
      originHostname = new URL(origin).hostname;
    } catch {
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
    }

    if (originHostname !== 'localhost' && originHostname !== '127.0.0.1') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
