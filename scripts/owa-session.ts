/**
 * Shared Outlook Web (OWA) session helper for the local work-comms bridge.
 *
 * Why this exists: Conditional Access blocks every *application* path into the tenant
 * (OAuth apps, Graph device-code, EWS). A signed-in browser session is still permitted,
 * so we drive one and reuse the access token the web app itself mints. The existing
 * calendar bridge (scripts/owa-calendar-source.ts) proved this; this module factors the
 * token-capture + REST-read out so the new mail and Teams sources reuse it.
 *
 * The session lives in a persistent Chromium profile created once with
 * scripts/owa-login.ts. Playwright is imported lazily so pure callers stay cheap.
 */
import { homedir } from 'os'
import { join } from 'path'

export const OWA_PROFILE_DIR = process.env.OWA_PROFILE_DIR || join(homedir(), '.ak-owa-profile')
const TOKEN_TIMEOUT_MS = Number(process.env.OWA_TOKEN_TIMEOUT_MS || 60_000)

export class OwaSessionError extends Error {
  constructor(message: string, reauthCmd = 'pnpm exec tsx scripts/owa-login.ts') {
    super(`${message}\nRe-authenticate with: ${reauthCmd}`)
    this.name = 'OwaSessionError'
  }
}

/** Decode a JWT payload without verifying it — we only need the claims for routing. */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** True when the token's audience matches `audience` (exact, or host of a URL audience). */
export function tokenMatchesAudience(token: string, audience: string): boolean {
  const claims = decodeJwtClaims(token)
  const aud = typeof claims?.aud === 'string' ? claims.aud : null
  if (!aud) return false
  if (aud === audience) return true
  // Some tokens carry the audience as a bare host or a GUID resource; accept a host match.
  try {
    return new URL(aud).host === new URL(audience).host
  } catch {
    return false
  }
}

/** The signed-in mailbox/user address, read from the token claims. */
export function accountFromToken(token: string): string | null {
  const c = decodeJwtClaims(token)
  for (const key of ['upn', 'preferred_username', 'unique_name', 'email']) {
    const v = c?.[key]
    if (typeof v === 'string' && v.includes('@')) return v.toLowerCase()
  }
  return null
}

export interface OwaRestGetter {
  /** GET a JSON resource with the captured Bearer token attached. Throws OwaSessionError on 401/403. */
  get: <T = unknown>(url: string, headers?: Record<string, string>) => Promise<T>
  /** The Bearer token that was captured (for claim inspection by the caller). */
  token: string
}

/**
 * Open the OWA profile, navigate to `warmupUrl`, capture the first Bearer token whose
 * audience matches `audience`, then run `fn` with a REST getter bound to that token.
 * The browser only exists to hold the session; all reads go over the supported REST API.
 *
 * `guardSubstr` (default "outlook.office.com") distinguishes an expired session (which
 * redirects to login) from a slow token, so we can fail with a clear re-auth message.
 */
export async function withOwaRest<T>(
  opts: {
    warmupUrl: string
    audience: string
    guardSubstr?: string
    profileDir?: string
    reauthCmd?: string
    /** Navigation wait. Heavy SPAs (Teams) never reach "networkidle" — use "domcontentloaded". */
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  },
  fn: (rest: OwaRestGetter) => Promise<T>,
): Promise<T> {
  const { chromium } = await import('playwright')
  const guard = opts.guardSubstr ?? 'outlook.office.com'
  const reauth = opts.reauthCmd

  const context = await chromium.launchPersistentContext(opts.profileDir ?? OWA_PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  })
  try {
    const page = context.pages()[0] ?? (await context.newPage())

    let token: string | null = null
    let resolveToken: () => void = () => {}
    const gotToken = new Promise<void>((resolve) => {
      resolveToken = resolve
    })
    page.on('request', (request) => {
      if (token) return
      const auth = request.headers()['authorization']
      if (!auth?.startsWith('Bearer ')) return
      const candidate = auth.slice(7)
      if (!tokenMatchesAudience(candidate, opts.audience)) return
      token = candidate
      resolveToken()
    })

    await page.goto(opts.warmupUrl, { waitUntil: opts.waitUntil ?? 'networkidle', timeout: 45000 })
    await Promise.race([gotToken, page.waitForTimeout(TOKEN_TIMEOUT_MS)])

    if (!token) {
      const url = page.url()
      if (!url.includes(guard)) {
        throw new OwaSessionError(`Session redirected away (${url}) — session expired.`, reauth)
      }
      throw new OwaSessionError(`No access token for ${opts.audience} appeared within the timeout.`, reauth)
    }

    const bound = token
    const rest: OwaRestGetter = {
      token: bound,
      get: async <R = unknown>(url: string, headers?: Record<string, string>): Promise<R> => {
        const res = await context.request.get(url, {
          headers: { Authorization: `Bearer ${bound}`, Accept: 'application/json', ...headers },
        })
        if (res.status() === 401 || res.status() === 403) {
          throw new OwaSessionError(`REST rejected the session token (${res.status()}) for ${url}.`, reauth)
        }
        if (!res.ok()) {
          throw new Error(`REST GET failed: ${res.status()} ${(await res.text()).slice(0, 300)}`)
        }
        return (await res.json()) as R
      },
    }
    return await fn(rest)
  } finally {
    await context.close()
  }
}
