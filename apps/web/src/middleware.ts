import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// In development: skip auth so the app runs without Edge/middleware issues (e.g. Google Drive)
export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }

  const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://localhost:3000'
  const SESSION_COOKIE = '__Secure-next-auth.session-token'
  if (req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next()
  }

  const signInUrl = new URL('/api/auth/signin', NEXT_PUBLIC_APP_URL)
  signInUrl.searchParams.set('callbackUrl', req.url)
  return NextResponse.redirect(signInUrl)
}

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js).*)',
  ],
}
