import { NextResponse } from 'next/server'
import { writeVoiceUploadPart, VoiceUploadError, VOICE_PART_MAX_BYTES } from '@ak-system/api'
import { resolveRequestSession } from '@/lib/request-session'

export const runtime = 'nodejs'

/**
 * One part of a resumable upload. Body is the raw bytes (web), or JSON `{ base64 }` (mobile —
 * React Native can't send a byte range of a file as a binary body). Re-sending overwrites.
 */
export async function PUT(
  req: Request,
  { params }: { params: { uploadId: string; index: string } },
): Promise<NextResponse> {
  const session = await resolveRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const declared = Number(req.headers.get('content-length') ?? 0)
  // base64 JSON is ~4/3 the raw size
  if (declared > VOICE_PART_MAX_BYTES * 1.4 + 1024) return NextResponse.json({ error: 'המקטע גדול מדי' }, { status: 413 })
  let bytes: Buffer
  try {
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      const body = (await req.json()) as { base64?: unknown }
      if (typeof body.base64 !== 'string') return NextResponse.json({ error: 'חסר base64' }, { status: 400 })
      bytes = Buffer.from(body.base64, 'base64')
    } else {
      bytes = Buffer.from(await req.arrayBuffer())
    }
  } catch {
    // The connection dropped mid-part — the client retries this part.
    return NextResponse.json({ error: 'המקטע לא התקבל במלואו' }, { status: 400 })
  }
  try {
    const result = await writeVoiceUploadPart(params.uploadId, Number(params.index), bytes)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof VoiceUploadError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[voice/uploads part]', err)
    return NextResponse.json({ error: 'Part failed' }, { status: 500 })
  }
}
