import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

const secret =
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === 'development' ? 'ak-system-dev-secret-change-in-production' : undefined)

// #region agent log — confirm NextAuth config in production (hypothesis: missing NEXTAUTH_SECRET)
if (process.env.NODE_ENV === 'production') {
  const hasSecret = Boolean(secret)
  console.error('[NextAuth] production config: NEXTAUTH_SECRET set=', hasSecret, hasSecret ? '' : '- Set NEXTAUTH_SECRET in Railway Variables (e.g. openssl rand -base64 32)')
}
// #endregion

const hasGoogleCreds = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET

// Comma-separated allowlist of Google emails permitted to sign in.
// Empty = allow any Google account (only safe when the app is not publicly reachable).
const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export const authOptions: NextAuthOptions = {
  trustHost: true,
  providers: hasGoogleCreds
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
      ]
    : [],
  secret,
  callbacks: {
    signIn({ user }) {
      if (allowedEmails.length === 0) return true
      const email = user.email?.toLowerCase()
      return Boolean(email && allowedEmails.includes(email))
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''
      }
      return session
    },
  },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
}
