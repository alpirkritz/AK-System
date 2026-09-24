import * as fs from 'fs'
import { NextResponse } from 'next/server'
import { getDb, voiceRecordings, eq } from '@ak-system/database'
import { resolveRequestSession } from '@/lib/request-session'

export const runtime = 'nodejs'

/** Streams a stored recording back to the signed-in owner only. */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const session = await resolveRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [rec] = await getDb()
    .select({ audioPath: voiceRecordings.audioPath, mimeType: voiceRecordings.mimeType })
    .from(voiceRecordings)
    .where(eq(voiceRecordings.id, params.id))
  if (!rec || !fs.existsSync(rec.audioPath)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const data = fs.readFileSync(rec.audioPath)
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': rec.mimeType,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
