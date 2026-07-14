import Database from 'better-sqlite3'
import {
  upsertGoogleCalendarConnection,
  getAccessTokenForConnection,
  listGoogleConnections,
} from '../packages/api/src/services/google-connections'

async function main(): Promise<void> {
  const prodPath = process.argv[2] || '/tmp/ak_prod.sqlite'
  const email = process.argv[3] || 'alpirkritz@gmail.com'

  const prod = new Database(prodPath, { readonly: true })
  const row = prod
    .prepare(
      'SELECT calendar_email, access_token, refresh_token, token_expires_at FROM google_connections WHERE calendar_email = ? LIMIT 1',
    )
    .get(email) as {
    calendar_email: string
    access_token: string | null
    refresh_token: string
    token_expires_at: string | null
  } | undefined

  if (!row?.refresh_token) throw new Error(`no refresh token for ${email} in ${prodPath}`)

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
