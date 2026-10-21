import { NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { processVoiceRecording, saveVoiceUpload, VoiceUploadError, VOICE_MAX_BYTES } from '@ak-system/api'
import { createNotification } from '@/lib/notification-store'
import { resolveRequestSession } from '@/lib/request-session'

export const runtime = 'nodejs'

/**
 * Multipart upload of a consented recording: `audio` (file), `consentConfirmed` ("true"),
 * `durationSeconds`, optional `meetingId`, `projectId`, `personIds` (comma separated),
 * `contextConfirmed` ("true" after the pre-upload review — attendees are not merged with
 * calendar invitees), and `source` ("live", the default, or "imported").
 * Returns right after the file is stored; transcription and analysis continue in the background.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await resolveRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'צפוי multipart/form-data' }, { status: 400 })
  }
  const audio = form.get('audio')
  if (!(audio instanceof Blob)) return NextResponse.json({ error: 'חסר קובץ הקלטה' }, { status: 400 })
  if (audio.size > VOICE_MAX_BYTES) return NextResponse.json({ error: 'ההקלטה גדולה מדי' }, { status: 413 })

  const db = getDb()
  try {
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from(await audio.arrayBuffer()),
      mimeType: audio.type || 'audio/webm',
      durationSeconds: Number(form.get('durationSeconds')),
      consentConfirmed: form.get('consentConfirmed') === 'true',
      meetingId: (form.get('meetingId') as string | null) || null,
      projectId: (form.get('projectId') as string | null) || null,
      personIds: String(form.get('personIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      contextConfirmed: form.get('contextConfirmed') === 'true',
      source: form.get('source') === 'imported' ? 'imported' : 'live',
    })
    void processVoiceRecording(db, recordingId)
      .then(async (rec) => {
        await createNotification({
          title: rec.status === 'completed' ? 'ההקלטה נותחה' : 'ניתוח ההקלטה נכשל',
          body: rec.status === 'completed' ? 'הסיכום וההתחייבויות מחכים לך.' : rec.error ?? 'אפשר לנסות שוב מעמוד ההקלטות.',
          url: `/voice?recording=${recordingId}`,
          type: 'system',
        })
      })
      .catch((err) => console.error('[voice/upload] processing failed:', err))
    return NextResponse.json({ recordingId })
  } catch (err) {
    if (err instanceof VoiceUploadError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[voice/upload]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 })
  }
}
