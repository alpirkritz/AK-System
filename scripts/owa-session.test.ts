import { describe, expect, it } from 'vitest'
import { accountFromToken, decodeJwtClaims, tokenMatchesAudience } from './owa-session'

/** Build an unsigned JWT with the given payload (header.payload.sig). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

describe('decodeJwtClaims', () => {
  it('decodes the payload', () => {
    expect(decodeJwtClaims(jwt({ aud: 'x', upn: 'a@b.com' }))).toEqual({ aud: 'x', upn: 'a@b.com' })
  })
  it('returns null for garbage', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull()
  })
})

describe('tokenMatchesAudience', () => {
  it('matches an exact audience', () => {
    expect(tokenMatchesAudience(jwt({ aud: 'https://outlook.office.com' }), 'https://outlook.office.com')).toBe(true)
  })
  it('matches on host when the audience is a URL variant', () => {
    expect(tokenMatchesAudience(jwt({ aud: 'https://outlook.office.com/' }), 'https://outlook.office.com')).toBe(true)
  })
  it('rejects a different audience', () => {
    expect(tokenMatchesAudience(jwt({ aud: 'https://graph.microsoft.com' }), 'https://outlook.office.com')).toBe(false)
  })
  it('rejects a token with no audience', () => {
    expect(tokenMatchesAudience(jwt({ upn: 'a@b.com' }), 'https://outlook.office.com')).toBe(false)
  })
})

describe('accountFromToken', () => {
  it('prefers upn', () => {
    expect(accountFromToken(jwt({ upn: 'Alpir@Dragontail.com', email: 'x@y.com' }))).toBe('alpir@dragontail.com')
  })
  it('falls back through preferred_username and email', () => {
    expect(accountFromToken(jwt({ preferred_username: 'p@q.com' }))).toBe('p@q.com')
    expect(accountFromToken(jwt({ email: 'e@f.com' }))).toBe('e@f.com')
  })
  it('returns null when no address claim is present', () => {
    expect(accountFromToken(jwt({ sub: '123' }))).toBeNull()
  })
})
