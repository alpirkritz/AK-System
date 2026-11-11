import { getDb } from '@ak-system/database'
import { processVoiceRecording } from '@ak-system/api'
import { createNotification } from '@/lib/notification-store'

/** Transcribe + analyze in the background and notify when done — shared by both upload paths. */
export function startVoiceProcessing(db: ReturnType<typeof getDb>, recordingId: string): void {
  void processVoiceRecording(db, recordingId)
    .then(async (rec) => {
      await createNotification({
        title: rec.status === 'completed' ? 'ההקלטה נותחה' : 'ניתוח ההקלטה נכשל',
        body: rec.status === 'completed' ? 'הסיכום וההתחייבויות מחכים לך.' : rec.error ?? 'אפשר לנסות שוב מעמוד ההקלטות.',
        url: `/voice?recording=${recordingId}`,
        type: 'system',
      })
    })
    .catch((err) => console.error('[voice] processing failed:', err))
}
