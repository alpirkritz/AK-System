import { NextResponse } from 'next/server'
import { createVoiceUpload, VoiceUploadError } from '@ak-system/api'
import { resolveRequestSession } from '@/lib/request-session'

export const runtime = 'nodejs'

/**
 * Starts (or resumes) a part-by-part recording upload — docs/specs/voice-recording-never-lost.md.
 * The same `clientSessionId` always returns the same `uploadId`, so a client that lost the
 * response can simply ask again.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await resolveRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'צפוי JSON' }, { status: 400 })
  }
  try {
    const result = await createVoiceUpload({
      clientSessionId: String(body.clientSessionId ?? ''),
      mimeType: String(body.mimeType ?? ''),
      totalBytes: Number(body.totalBytes),
      partSize: Number(body.partSize),
      durationSeconds: Number(body.durationSeconds),
      consentConfirmed: body.consentConfirmed === true,
      contextConfirmed: body.contextConfirmed === true,
      meetingId: typeof body.meetingId === 'string' && body.meetingId ? body.meetingId : null,
      projectId: typeof body.projectId === 'string' && body.projectId ? body.projectId : null,
      personIds: Array.isArray(body.personIds) ? body.personIds.map(String).filter(Boolean) : [],
      source: body.source === 'imported' ? 'imported' : 'live',
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof VoiceUploadError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[voice/uploads]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 })
  }
}
