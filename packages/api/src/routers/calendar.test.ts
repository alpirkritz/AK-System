import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index'
import { createContext, createCallerFactory } from '../trpc'
import { createTestCaller, getTestDb } from '../test-utils'

async function createUnauthCaller() {
  const ctx = await createContext({ db: getTestDb(), session: null })
  return createCallerFactory(appRouter)(ctx)
}

describe('calendar router', () => {
  describe('startGoogleOAuth', () => {
    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'
    })

    it('rejects unauthenticated callers', async () => {
      const caller = await createUnauthCaller()
      await expect(caller.calendar.startGoogleOAuth({})).rejects.toThrow(/התחברות/)
    })

    it('rejects a non-email hint', async () => {
      const caller = await createTestCaller()
      await expect(
        caller.calendar.startGoogleOAuth({ hint: 'not-an-email' }),
      ).rejects.toThrow()
    })

    it('returns a Google auth URL with mobile return state', async () => {
      const caller = await createTestCaller()
      const { authUrl } = await caller.calendar.startGoogleOAuth({ returnTo: 'mobile' })
      expect(authUrl).toMatch(/^https:\/\/accounts\.google\.com\//)
      expect(authUrl).toContain('calendar')
      const state = new URL(authUrl).searchParams.get('state')
      expect(state).toBeTruthy()
      const parsed = JSON.parse(Buffer.from(state!, 'base64url').toString('utf8')) as {
        userId: string
        returnTo: string
      }
      expect(parsed.userId).toBe('test-user')
      expect(parsed.returnTo).toBe('mobile')
    })
  })
})
