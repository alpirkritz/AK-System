import { randomUUID } from 'node:crypto'
import { getDb } from '@ak-system/database'
import { sql } from 'drizzle-orm'
import type { GoogleConnection } from './google-connections'

type GoogleConnectionRow = {
  id: string
  calendar_email: string
  access_token: string | null
  refresh_token: string
  token_expires_at: string | null
}

export function fetchGoogleConnectionsFromSqlite(): GoogleConnection[] {
  const db = getDb()
  const rows = db.all<GoogleConnectionRow>(sql`
    SELECT id, calendar_email, access_token, refresh_token, token_expires_at
    FROM google_connections
    WHERE provider = 'google' AND is_active = 1 AND refresh_token != ''
    ORDER BY created_at ASC
  `)
  return rows.map((row) => ({
    id: row.id,
    calendarEmail: row.calendar_email,
    accessToken: row.access_token || '',
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at || new Date(Date.now() + 3600000).toISOString(),
  }))
}

export function updateGoogleAccessTokenSqlite(input: {
  connectionId: string
  accessToken: string
  tokenExpiresAt: string
}): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.run(sql`
    UPDATE google_connections
    SET access_token = ${input.accessToken},
        token_expires_at = ${input.tokenExpiresAt},
        updated_at = ${now}
    WHERE id = ${input.connectionId}
  `)
}

export function upsertGoogleConnectionSqlite(input: {
  userId: string
  calendarEmail: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
}): void {
  const db = getDb()
  const now = new Date().toISOString()
  const existing = db.all<{ id: string; refresh_token: string }>(sql`
    SELECT id, refresh_token FROM google_connections
    WHERE provider = 'google' AND calendar_email = ${input.calendarEmail}
    LIMIT 1
  `)[0]

  if (existing) {
    db.run(sql`
      UPDATE google_connections
      SET
        user_id = ${input.userId},
        access_token = ${input.accessToken},
        refresh_token = ${input.refreshToken || existing.refresh_token},
        token_expires_at = ${input.tokenExpiresAt},
        is_active = 1,
        updated_at = ${now}
      WHERE id = ${existing.id}
    `)
    return
  }

  db.run(sql`
    INSERT INTO google_connections (
      id, user_id, provider, calendar_email, access_token, refresh_token,
      token_expires_at, is_active, created_at, updated_at
    ) VALUES (
      ${randomUUID()},
      ${input.userId},
      'google',
      ${input.calendarEmail},
      ${input.accessToken},
      ${input.refreshToken},
      ${input.tokenExpiresAt},
      1,
      ${now},
      ${now}
    )
  `)
}
