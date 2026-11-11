import { NextResponse } from 'next/server'
import { getVoiceUploadStatus, VoiceUploadError } from '@ak-system/api'
import { resolveRequestSession } from '@/lib/request-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Which parts the server already has, so a resuming client skips them. */
export async function GET(req: Request, { params }: { params: { uploadId: string } }): Promise<NextResponse> {
  const session = await resolveRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await getVoiceUploadStatus(params.uploadId))
  } catch (err) {
    if (err instanceof VoiceUploadError) return NextResponse.json({ error: err.message }, { status: 404 })
    console.error('[voice/uploads status]', err)
    return NextResponse.json({ error: 'Status failed' }, { status: 500 })
  }
}
