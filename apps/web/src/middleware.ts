import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// In development: skip auth so the app runs without Edge/middleware issues (e.g. Google Drive)
// TEMPORARY: skip auth redirect in production (Edge may not get env vars; re-enable later by uncommenting auth block below)
export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }
  // Skip auth in production so deploy is reachable without sign-in
  return NextResponse.next()

  // --- Re-enable sign-in redirect when ready (and ensure NEXTAUTH_URL / cookies work):
  // if (req.nextUrl.pathname.startsWith('/api/auth')) return NextResponse.next()
  // const hasSession = req.cookies.has('__Secure-next-auth.session-token') || req.cookies.has('next-auth.session-token')
  // if (hasSession) return NextResponse.next()
  // const signInUrl = new URL('/api/auth/signin', req.nextUrl.origin)
  // signInUrl.searchParams.set('callbackUrl', req.url)
  // return NextResponse.redirect(signInUrl)
}

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js).*)',
  ],
}
