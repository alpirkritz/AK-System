import { decode, encode } from 'next-auth/jwt'
import type { AuthSession } from '@ak-system/api'

const MOBILE_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

function authSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is not configured')
  return secret
}

function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<{ sub: string; email: string; name?: string } | null> {
  const clientIds = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ]
    .flatMap((v) => (v ?? '').split(','))
    .map((v) => v.trim())
    .filter(Boolean)

  if (clientIds.length === 0) return null

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  )
  if (!res.ok) return null

  const data = (await res.json()) as {
    aud?: string
    sub?: string
    email?: string
    name?: string
    email_verified?: string
  }

  if (!data.sub || !data.email || !clientIds.includes(String(data.aud))) return null
  if (data.email_verified === 'false') return null

  const allow = allowedEmails()
  if (allow.length > 0 && !allow.includes(data.email.toLowerCase())) return null

  return { sub: data.sub, email: data.email, name: data.name }
}

export async function createMobileAccessToken(user: {
  sub: string
  email: string
  name?: string
}): Promise<string> {
  return encode({
    token: {
      sub: user.sub,
      email: user.email,
      name: user.name ?? user.email.split('@')[0],
    },
    secret: authSecret(),
    maxAge: MOBILE_TOKEN_MAX_AGE,
  })
}

export async function sessionFromBearer(bearer: string): Promise<AuthSession | null> {
  const token = bearer.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  try {
    const decoded = await decode({ token, secret: authSecret() })
    if (!decoded?.sub || !decoded.email) return null
    return {
      user: {
        id: String(decoded.sub),
        email: String(decoded.email),
        name: decoded.name ? String(decoded.name) : undefined,
      },
      expires: '',
    }
  } catch {
    return null
  }
}
