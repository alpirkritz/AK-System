/**
 * Local OAuth helper for refreshing Google Calendar tokens used by the Outlook bridge.
 * Usage: pnpm exec tsx scripts/google-oauth-local.ts --port 3099 --redirect-uri http://127.0.0.1:3099/callback
 */
import http from 'node:http'
import { exec } from 'node:child_process'
import { URL } from 'node:url'
import {
  exchangeGoogleCalendarCode,
  getGoogleCalendarAuthUrl,
} from '../packages/api/src/google-calendar-auth'
import {
  getAccessTokenForConnection,
  listGoogleConnections,
  upsertGoogleCalendarConnection,
} from '../packages/api/src/services/google-connections'

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] || fallback : fallback
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open ${JSON.stringify(url)}` :
    process.platform === 'win32' ? `start ${JSON.stringify(url)}` :
    `xdg-open ${JSON.stringify(url)}`
  exec(cmd)
}

async function main(): Promise<void> {
  const port = Number(arg('--port', '3099'))
  const redirectUri = arg('--redirect-uri', `http://127.0.0.1:${port}/callback`)
  const hint = arg('--hint', 'alpirkritz@gmail.com')

  const authUrl = getGoogleCalendarAuthUrl(redirectUri, {
    loginHint: hint,
    state: Buffer.from(JSON.stringify({ userId: 'default' })).toString('base64url'),
  })

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end('not found')
          return
        }

        const error = url.searchParams.get('error')
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(`Google OAuth error: ${error}`)
          reject(new Error(error))
          server.close()
          return
        }

        const code = url.searchParams.get('code')
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('missing code')
          reject(new Error('missing code'))
          server.close()
          return
        }

        const tokens = await exchangeGoogleCalendarCode(code, redirectUri)
        if (!tokens.refresh_token) {
          throw new Error(
            'Google did not return a refresh token. Revoke app access at myaccount.google.com/permissions and retry.',
          )
        }

        const result = await upsertGoogleCalendarConnection({
          userId: 'default',
          calendarEmail: tokens.email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(tokens.expiry_date).toISOString(),
        })
        if (!result.ok) throw new Error(result.error)

        const conn = (await listGoogleConnections()).find(
          (c) => c.calendarEmail.toLowerCase() === tokens.email.toLowerCase(),
        )
        if (!conn) throw new Error('connection not found after upsert')
        await getAccessTokenForConnection(conn, { forceRefresh: true })

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<html><body dir="rtl" style="font-family:sans-serif;padding:2rem">` +
          `<h2>חיבור Google הצליח ✓</h2>` +
          `<p>${tokens.email} — אפשר לסגור את החלון.</p>` +
          `</body></html>`,
        )

        console.log(`[oauth-local] connected ${tokens.email}`)
        server.close()
        resolve()
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end((err as Error).message)
        reject(err)
        server.close()
      }
    })

    server.listen(port, '127.0.0.1', () => {
      console.log(`[oauth-local] listening on ${redirectUri}`)
      console.log('[oauth-local] opening browser...')
      openBrowser(authUrl)
    })

    server.on('error', reject)
    setTimeout(() => {
      server.close()
      reject(new Error('OAuth timed out after 5 minutes'))
    }, 5 * 60 * 1000)
  })
}

main().catch((err) => {
  console.error('[oauth-local] FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
