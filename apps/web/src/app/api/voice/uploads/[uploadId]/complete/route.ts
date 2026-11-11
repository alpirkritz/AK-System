import { NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { completeVoiceUpload, VoiceUploadError } from '@ak-system/api'
import { resolveRequestSession } from '@/lib/request-session'
import { startVoiceProcessing } from '../../../_lib/start-processing'

export const runtime = 'nodejs'

/**
 * Assembles the parts into the recording and starts processing. Optional JSON body carries the
 * people/project/meeting confirmed at review time. Idempotent: a repeat returns the same id.
 */
export async function POST(req: Request, { params }: { params: { uploadId: string } }): Promise<NextResponse> {
  const session = await resolveRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'צפוי JSON' }, { status: 400 })
  }
  const context: Parameters<typeof completeVoiceUpload>[2] = {}
  if ('meetingId' in body) context.meetingId = typeof body.meetingId === 'string' && body.meetingId ? body.meetingId : null
  if ('projectId' in body) context.projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
  if (Array.isArray(body.personIds)) context.personIds = body.personIds.map(String).filter(Boolean)
  if (body.contextConfirmed === true) context.contextConfirmed = true
  if (typeof body.durationSeconds === 'number') context.durationSeconds = body.durationSeconds

  const db = getDb()
  try {
    const { recordingId, alreadyCompleted } = await completeVoiceUpload(db, params.uploadId, context)
    if (!alreadyCompleted) startVoiceProcessing(db, recordingId)
    return NextResponse.json({ recordingId })
  } catch (err) {
    if (err instanceof VoiceUploadError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[voice/uploads complete]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Complete failed' }, { status: 500 })
  }
}
