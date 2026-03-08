import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

const secret =
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === 'development' ? 'ak-system-dev-secret-change-in-production' : undefined)

const hasGoogleCreds = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET

export const authOptions: NextAuthOptions = {
  providers: hasGoogleCreds
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
      ]
    : [],
  secret,
  pages: {
    signIn: '/api/auth/signin',
  },
  callbacks: {
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''
      }
      return session
    },
  },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
}
