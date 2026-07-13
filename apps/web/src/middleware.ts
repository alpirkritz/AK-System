import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth gate for page routes. API routes are excluded via the matcher below and
// enforce their own auth:
//   - /api/trpc      → tRPC protectedProcedure (getServerSession)
//   - /api/whatsapp, /api/telegram, /api/cron → Bearer/secret tokens
//   - /api/auth      → NextAuth itself
// Static assets (sw.js, manifest.json, icons) are also excluded so the PWA installs.
export function middleware(req: NextRequest) {
  // In development, skip auth so the app runs without Edge/Google Drive issues.
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }

  // Escape hatch: allow disabling auth in production if needed.
  if (process.env.SKIP_AUTH_IN_PRODUCTION === '1') {
    return NextResponse.next()
  }

  const hasSession =
    req.cookies.has('__Secure-next-auth.session-token') ||
    req.cookies.has('next-auth.session-token')

  if (hasSession) {
    return NextResponse.next()
  }

  if (req.nextUrl.pathname === '/login') {
    return NextResponse.next()
  }

  const host = req.nextUrl.hostname
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  // Keep auth redirects on the same origin the user opened (localhost vs tunnel).
  // Using NEXT_PUBLIC_APP_URL for localhost sent users to a stale tunnel → Cloudflare 1033.
  const appOrigin = (
    isLocal ? req.nextUrl.origin : (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin)
  ).replace(/\/$/, '')
  const callbackUrl = `${appOrigin}${req.nextUrl.pathname}${req.nextUrl.search}`

  const signInUrl = new URL('/login', appOrigin)
  signInUrl.searchParams.set('callbackUrl', callbackUrl)
  return NextResponse.redirect(signInUrl)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|login).*)',
  ],
}
