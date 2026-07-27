import Database from 'better-sqlite3'
import fs from 'node:fs'
import {
  upsertGoogleCalendarConnection,
  getAccessTokenForConnection,
  listGoogleConnections,
} from '../packages/api/src/services/google-connections'

type GoogleTokenRow = {
  calendar_email: string
  access_token: string | null
  refresh_token: string
  token_expires_at: string | null
}

function readJsonRow(path: string, email: string): GoogleTokenRow | undefined {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as Partial<GoogleTokenRow>
  if (
    typeof parsed.calendar_email !== 'string' ||
    typeof parsed.refresh_token !== 'string' ||
    parsed.calendar_email.toLowerCase() !== email.toLowerCase()
  ) {
    return undefined
  }
  return {
    calendar_email: parsed.calendar_email,
    access_token: typeof parsed.access_token === 'string' ? parsed.access_token : null,
    refresh_token: parsed.refresh_token,
    token_expires_at:
      typeof parsed.token_expires_at === 'string' ? parsed.token_expires_at : null,
  }
}

async function main(): Promise<void> {
  const jsonMode = process.argv[2] === '--json'
  const sourcePath = (jsonMode ? process.argv[3] : process.argv[2]) || '/tmp/ak_prod.sqlite'
  const email = (jsonMode ? process.argv[4] : process.argv[3]) || 'alpirkritz@gmail.com'

  let row: GoogleTokenRow | undefined
  if (jsonMode) {
    row = readJsonRow(sourcePath, email)
  } else {
    const prod = new Database(sourcePath, { readonly: true })
    try {
      row = prod
        .prepare(
          'SELECT calendar_email, access_token, refresh_token, token_expires_at FROM google_connections WHERE calendar_email = ? LIMIT 1',
        )
        .get(email) as GoogleTokenRow | undefined
    } finally {
      prod.close()
    }
  }

  if (!row?.refresh_token) throw new Error(`no refresh token for ${email} in ${sourcePath}`)

  const result = await upsertGoogleCalendarConnection({
    userId: 'default',
    calendarEmail: row.calendar_email,
    accessToken: row.access_token || '',
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at || new Date(Date.now() + 3600000).toISOString(),
  })
  if (!result.ok) throw new Error(result.error)

  const conn = (await listGoogleConnections()).find(
    (c) => c.calendarEmail.toLowerCase() === row.calendar_email.toLowerCase(),
  )
  if (!conn) throw new Error('connection missing after import')
  await getAccessTokenForConnection(conn, { forceRefresh: true })
  console.log(`imported and verified ${row.calendar_email}`)
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
