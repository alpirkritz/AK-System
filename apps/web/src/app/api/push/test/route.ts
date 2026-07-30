import { type NextRequest, NextResponse } from 'next/server'
import { sendBrowserPush } from '@/lib/web-push'
import { sendExpoPush } from '@/lib/expo-push'
import { createNotification } from '@/lib/notification-store'
import { sessionFromBearer } from '@/lib/mobile-auth'

async function requireMobileSession(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth) return null
  return sessionFromBearer(auth)
}

/** POST /api/push/test — send test push to all Web Push + Expo devices */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireMobileSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { title?: string; body?: string; url?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    body = {}
  }

  const title = body.title?.trim() || 'ARO'
  const text = body.body?.trim() || 'נוטיפיקציית בדיקה ✓'
  const url = body.url?.trim() || '/chat'

  try {
    await createNotification({ title, body: text, url, type: 'system' })
    const webSent = await sendBrowserPush(title, text, url)
    const expoSent = await sendExpoPush(title, text, url)
    return NextResponse.json({ webSent, expoSent })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Test push failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
