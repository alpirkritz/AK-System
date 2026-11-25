import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { ingestSlackCache, scanSlackCommitments, type SlackCachePayload } from '@ak-system/api'
import { verifyWorkCommsAuth } from '@/lib/work-comms-auth'

/**
 * POST /api/work-comms/slack/ingest — members, conversations and messages decoded from the Slack
 * desktop app's local cache by the Mac bridge (docs/specs/local-chat-cache-ingest.md).
 * Persists, links members to People, and runs the Slack commitment scan. Bearer secret auth.
 */
/** One scan at a time: a second post while the first scan runs must not scan the same messages. */
let scanRunning: Promise<unknown> | null = null

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWorkCommsAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: Partial<SlackCachePayload>
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body.teamId !== 'string' || typeof body.selfUserId !== 'string') {
    return NextResponse.json({ error: 'teamId and selfUserId are required' }, { status: 400 })
  }
  const payload: SlackCachePayload = {
    teamId: body.teamId,
    selfUserId: body.selfUserId,
    members: Array.isArray(body.members) ? body.members : [],
    conversations: Array.isArray(body.conversations) ? body.conversations : [],
    messages: Array.isArray(body.messages) ? body.messages : [],
  }
  try {
    const db = getDb()
    const result = await ingestSlackCache(db, payload, { scan: false })
    // The commitment scan calls Gemini per conversation and can take minutes; run it after
    // replying so the bridge's request isn't cut off by the ngrok timeout (503).
    if (!scanRunning) {
      scanRunning = scanSlackCommitments(db)
        .then((scan) => console.log(`[work-comms/slack/ingest] scan: ${scan.channels} conversations, ${scan.commitments} commitments`))
        .catch((err) => console.error('[work-comms/slack/ingest] scan failed', err))
        .finally(() => {
          scanRunning = null
        })
    }
    return NextResponse.json({ ok: true, ...result, scan: 'started' })
  } catch (err) {
    console.error('[work-comms/slack/ingest]', err)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }
}
