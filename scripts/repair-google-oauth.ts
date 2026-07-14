import {
  getAccessTokenForConnection,
  listGoogleConnections,
  upsertGoogleCalendarConnection,
  type GoogleConnection,
} from '../packages/api/src/services/google-connections'

async function fetchSupabaseConnections(): Promise<GoogleConnection[]> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []

  const params = new URLSearchParams({
    provider: 'eq.google',
    is_active: 'eq.true',
    select: 'id,calendar_email,access_token,refresh_token,token_expires_at',
    order: 'created_at.asc',
  })

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/calendar_connections?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    console.log('supabase fetch failed:', res.status)
    return []
  }

  const data = (await res.json()) as Array<{
    id: string
    calendar_email: string | null
    access_token: string | null
    refresh_token: string | null
    token_expires_at: string | null
  }>

  return data
    .filter((row) => row.refresh_token)
    .map((row) => ({
      id: row.id,
      calendarEmail: row.calendar_email || 'unknown',
      accessToken: row.access_token || '',
      refreshToken: row.refresh_token!,
      tokenExpiresAt: row.token_expires_at || new Date(Date.now() + 3600000).toISOString(),
    }))
}

async function testConnection(conn: GoogleConnection): Promise<boolean> {
  try {
    await getAccessTokenForConnection(conn, { forceRefresh: true })
    return true
  } catch {
    return false
  }
}

async function repairFromSupabase(): Promise<boolean> {
  const supa = await fetchSupabaseConnections()
  const target = supa.find((c) => c.calendarEmail.toLowerCase() === 'alpirkritz@gmail.com')
  if (!target) {
    console.log('repair: no Supabase row for alpirkritz@gmail.com')
    return false
  }
  if (!(await testConnection(target))) {
    console.log('repair: Supabase refresh token also invalid')
    return false
  }
  const result = await upsertGoogleCalendarConnection({
    userId: 'default',
    calendarEmail: target.calendarEmail,
    accessToken: target.accessToken,
    refreshToken: target.refreshToken,
    tokenExpiresAt: target.tokenExpiresAt,
  })
  if (!result.ok) {
    console.log('repair: upsert failed:', result.error)
    return false
  }
  console.log('repair: copied valid Supabase token into local SQLite')
  return true
}

async function main(): Promise<void> {
  const mode = process.argv[2] || 'probe'

  if (mode === 'probe') {
    for (const c of await listGoogleConnections()) {
      const ok = await testConnection(c)
      console.log(`local ${c.calendarEmail}: ${ok ? 'OK' : 'INVALID'}`)
    }
    try {
      for (const c of await fetchSupabaseConnections()) {
        const ok = await testConnection(c)
        console.log(`supabase ${c.calendarEmail}: ${ok ? 'OK' : 'INVALID'}`)
      }
    } catch (err) {
      console.log('supabase: unreachable —', (err as Error).message)
    }
    return
  }

  if (mode === 'repair') {
    const conns = await listGoogleConnections()
    const local = conns.find((c) => c.calendarEmail.toLowerCase() === 'alpirkritz@gmail.com')
    if (local && (await testConnection(local))) {
      console.log('repair: local token already valid')
      return
    }
    const repaired = await repairFromSupabase()
    if (!repaired) process.exit(1)
    return
  }

  if (mode === 'verify') {
    const conn = (await listGoogleConnections()).find(
      (c) => c.calendarEmail.toLowerCase() === 'alpirkritz@gmail.com',
    )
    if (!conn) throw new Error('no connection for alpirkritz@gmail.com')
    await getAccessTokenForConnection(conn, { forceRefresh: true })
    console.log(`verify: ${conn.calendarEmail} OK`)
    return
  }

  console.error('usage: probe | repair | verify')
  process.exit(1)
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
