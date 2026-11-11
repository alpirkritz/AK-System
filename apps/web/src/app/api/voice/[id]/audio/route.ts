import * as fs from 'fs'
import { Readable } from 'stream'
import { NextResponse } from 'next/server'
import { getDb, voiceRecordings, eq } from '@ak-system/database'
import { resolveRequestSession } from '@/lib/request-session'

export const runtime = 'nodejs'

/**
 * Streams a stored recording back to the signed-in owner only.
 *
 * Supports HTTP Range requests. Without them a browser cannot seek: setting
 * `audio.currentTime` to the middle of the file silently restarts from 0, so the
 * speaker-identification sample played the whole recording from the start instead
 * of just the quoted segment. The file is streamed (not read into memory) so a long
 * recording does not cost its full size in RAM per request.
 */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const session = await resolveRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [rec] = await getDb()
    .select({ audioPath: voiceRecordings.audioPath, mimeType: voiceRecordings.mimeType })
    .from(voiceRecordings)
    .where(eq(voiceRecordings.id, params.id))
  if (!rec || !fs.existsSync(rec.audioPath)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const size = fs.statSync(rec.audioPath).size
  const baseHeaders: Record<string, string> = {
    'Content-Type': rec.mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range')?.trim() ?? '')
  if (range && size > 0) {
    let start: number
    let end: number
    if (range[1] === '' && range[2] !== '') {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(range[2]))
      end = size - 1
    } else {
      start = Number(range[1])
      end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1)
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } })
    }
    const stream = Readable.toWeb(fs.createReadStream(rec.audioPath, { start, end })) as unknown as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
      },
    })
  }

  const stream = Readable.toWeb(fs.createReadStream(rec.audioPath)) as unknown as ReadableStream
  return new Response(stream, { headers: { ...baseHeaders, 'Content-Length': String(size) } })
}
