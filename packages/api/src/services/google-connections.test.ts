import { describe, it, expect, beforeEach } from 'vitest'
import {
  makeGoogleCalendarId,
  parseGoogleCalendarId,
  upsertGoogleCalendarConnection,
  listGoogleConnections,
} from './google-connections'
import * as fs from 'node:fs'
import * as path from 'node:path'

const testDb = path.join(__dirname, '../../test-data/google-sqlite-test.sqlite')

describe('google-connections helpers', () => {
  it('makeGoogleCalendarId encodes email and native id', () => {
    expect(makeGoogleCalendarId('alpirkritz@gmail.com', 'primary')).toBe(
      'google:alpirkritz@gmail.com:primary'
    )
  })

  it('parseGoogleCalendarId round-trips composite ids', () => {
    const composite = makeGoogleCalendarId('alpir@daz.guru', 'abc@group.calendar.google.com')
    expect(parseGoogleCalendarId(composite)).toEqual({
      email: 'alpir@daz.guru',
      calendarId: 'abc@group.calendar.google.com',
    })
  })

  it('parseGoogleCalendarId returns null for legacy native ids', () => {
    expect(parseGoogleCalendarId('primary')).toBeNull()
    expect(parseGoogleCalendarId('apple:foo')).toBeNull()
  })

  describe('sqlite storage', () => {
    beforeEach(() => {
      process.env.DATABASE_PATH = testDb
      if (fs.existsSync(testDb)) fs.unlinkSync(testDb)
    })

    it('upserts and lists connections from sqlite', async () => {
      const result = await upsertGoogleCalendarConnection({
        userId: 'user-1',
        calendarEmail: 'alpirkritz@gmail.com',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        tokenExpiresAt: new Date().toISOString(),
      })
      expect(result).toEqual({ ok: true })

      const connections = await listGoogleConnections()
      expect(connections).toHaveLength(1)
      expect(connections[0]?.calendarEmail).toBe('alpirkritz@gmail.com')
      expect(connections[0]?.refreshToken).toBe('refresh-1')
    })
  })
})
