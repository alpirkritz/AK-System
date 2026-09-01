import { describe, expect, it } from 'vitest'
import {
  encodeGoogleCalendarOAuthState,
  parseGoogleCalendarOAuthState,
  googleCalendarOAuthFinishUrl,
  googleCalendarOAuthLandingHtml,
  MOBILE_CALENDAR_OAUTH_SCHEME,
} from './google-calendar-auth'

describe('Google Calendar OAuth state', () => {
  it('round-trips userId and mobile returnTo', () => {
    const encoded = encodeGoogleCalendarOAuthState({ userId: 'user-1', returnTo: 'mobile' })
    expect(parseGoogleCalendarOAuthState(encoded)).toEqual({
      userId: 'user-1',
      returnTo: 'mobile',
    })
  })

  it('defaults missing or corrupt state to web/default', () => {
    expect(parseGoogleCalendarOAuthState(null)).toEqual({ userId: 'default', returnTo: 'web' })
    expect(parseGoogleCalendarOAuthState('%%%not-base64%%%')).toEqual({
      userId: 'default',
      returnTo: 'web',
    })
  })

  it('treats omitted returnTo as web so existing Settings links stay unchanged', () => {
    const encoded = Buffer.from(JSON.stringify({ userId: 'abc' })).toString('base64url')
    expect(parseGoogleCalendarOAuthState(encoded)).toEqual({ userId: 'abc', returnTo: 'web' })
  })
})

describe('googleCalendarOAuthFinishUrl', () => {
  it('returns Settings for web success', () => {
    expect(
      googleCalendarOAuthFinishUrl({
        returnTo: 'web',
        appUrl: 'https://example.test',
        email: 'me@x.com',
      }),
    ).toBe('https://example.test/settings?google_connected=1&email=me%40x.com')
  })

  it('returns the Helm deep link for mobile success', () => {
    expect(
      googleCalendarOAuthFinishUrl({
        returnTo: 'mobile',
        appUrl: 'https://example.test',
        email: 'me@x.com',
      }),
    ).toBe(`${MOBILE_CALENDAR_OAUTH_SCHEME}?google_connected=1&email=me%40x.com`)
  })

  it('returns a mobile error deep link', () => {
    expect(
      googleCalendarOAuthFinishUrl({
        returnTo: 'mobile',
        appUrl: 'https://example.test',
        error: 'oauth_failed',
      }),
    ).toBe(`${MOBILE_CALENDAR_OAUTH_SCHEME}?google_error=oauth_failed`)
  })
})

describe('googleCalendarOAuthLandingHtml', () => {
  it('navigates to the Helm scheme so AuthSession can close', () => {
    const html = googleCalendarOAuthLandingHtml('helm://calendar?google_connected=1')
    expect(html).toContain('location.replace("helm://calendar?google_connected=1")')
    expect(html).toContain('חזרה ל-ARO')
  })
})
