import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// In development: skip auth so the app runs without Edge/middleware issues (e.g. Google Drive)
export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }

  const SESSION_COOKIE = '__Secure-next-auth.session-token'
  if (req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next()
  }

  // Use request origin so we never redirect to a different host (avoids ERR_TOO_MANY_REDIRECTS when NEXT_PUBLIC_APP_URL is wrong or missing in Edge)
  const signInUrl = new URL('/api/auth/signin', req.nextUrl.origin)
  signInUrl.searchParams.set('callbackUrl', req.url)
  return NextResponse.redirect(signInUrl)
}

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js).*)',
  ],
}
