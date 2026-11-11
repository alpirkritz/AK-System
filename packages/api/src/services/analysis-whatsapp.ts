/**
 * Sends the regular meeting analysis to Alpir's WhatsApp once.
 * A failed send leaves the stamp empty.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { meetingAnalyses, meetings, type getDb } from '@ak-system/database'
import { sendBridgeText } from './whatsapp-bridge-client'
import { formatAnalysisMessage } from './analysis-message'
import type { AnalysisResult } from './meeting-analysis'

type Db = ReturnType<typeof getDb>

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Sends once. Returns sent:false when already notified, incomplete, or the bridge rejects it. */
export async function notifyAnalysisOnWhatsApp(
  db: Db,
  analysisId: string,
): Promise<{ sent: boolean }> {
  const [row] = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, analysisId))
  if (!row || row.status !== 'completed' || row.whatsappNotifiedAt) return { sent: false }
  if (!row.topic || row.score == null) return { sent: false }

  const [meeting] = await db
    .select({ title: meetings.title, date: meetings.date })
    .from(meetings)
    .where(eq(meetings.id, row.meetingId))
  if (!meeting) return { sent: false }

  const text = formatAnalysisMessage(
    {
      hatName: row.hatName ?? '',
      topic: row.topic,
      mood: row.mood ?? '',
      subtext: row.subtext ?? '',
      keyInsight: row.keyInsight ?? '',
      score: row.score,
      scoreRationale: row.scoreRationale ?? '',
      kaizenKeep: row.kaizenKeep ?? '',
      kaizenImprove: row.kaizenImprove ?? '',
      openQuestion: row.openQuestion ?? '',
      participants: parseJson<AnalysisResult['participants']>(row.participantsJson, []),
      actionItems: parseJson<AnalysisResult['actionItems']>(row.actionItemsJson, []),
    },
    meeting.title,
    meeting.date,
  )

  const now = new Date().toISOString()
  const claimed = await db
    .update(meetingAnalyses)
    .set({ whatsappNotifiedAt: now })
    .where(and(eq(meetingAnalyses.id, analysisId), isNull(meetingAnalyses.whatsappNotifiedAt)))
    .returning({ id: meetingAnalyses.id })
  if (claimed.length === 0) return { sent: false }

  try {
    const sent = await sendBridgeText(text)
    if (!sent.ok) {
      await db.update(meetingAnalyses).set({ whatsappNotifiedAt: null }).where(eq(meetingAnalyses.id, analysisId))
      return { sent: false }
    }
  } catch {
    await db.update(meetingAnalyses).set({ whatsappNotifiedAt: null }).where(eq(meetingAnalyses.id, analysisId))
    return { sent: false }
  }
  return { sent: true }
}
