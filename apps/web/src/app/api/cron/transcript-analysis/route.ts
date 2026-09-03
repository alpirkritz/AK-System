import { type NextRequest, NextResponse } from 'next/server'
import { getDb, meetings, meetingNotes, meetingAnalyses } from '@ak-system/database'
import { eq, and, isNull, isNotNull, desc } from 'drizzle-orm'
import { pushAssistantMessage } from '@/lib/push-notifications'
import { formatAnalysisMessage } from '@/lib/analysis-message-formatter'
import { analyzeTranscript } from '@ak-system/api'

const TIMEZONE = process.env.TIMEZONE || 'Asia/Jerusalem'

/**
 * Cron: Transcript analysis (run every 15 minutes).
 * Finds recently ended meetings with transcripts and no analysis, runs analysis, and sends formatted message.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runTranscriptAnalysis(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runTranscriptAnalysis(request)
}

async function runTranscriptAnalysis(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const db = getDb()
    const now = new Date()
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

    // Find meetings that ended in the last 30 minutes with transcripts but no analysis
    // (or failed analysis from more than 1 hour ago for retry)
    const eligibleMeetings = await db
      .select({
        meetingId: meetings.id,
        meetingTitle: meetings.title,
        meetingDate: meetings.date,
        meetingTime: meetings.time,
        meetingEndTime: meetings.endTime,
        noteId: meetingNotes.id,
        transcriptText: meetingNotes.bodyText,
        analysisId: meetingAnalyses.id,
        analysisStatus: meetingAnalyses.status,
        analysisCreatedAt: meetingAnalyses.createdAt,
      })
      .from(meetings)
      .leftJoin(meetingNotes, eq(meetingNotes.meetingId, meetings.id))
      .leftJoin(meetingAnalyses, eq(meetingAnalyses.meetingId, meetings.id))
      .where(
        and(
          isNotNull(meetingNotes.bodyText),
          // Either no analysis exists, or analysis failed more than 1 hour ago
        )
      )
      .orderBy(desc(meetings.date), desc(meetings.time))
      .limit(10)

    // Filter in JS for complex time logic
    const toAnalyze = eligibleMeetings.filter((m) => {
      // Must have transcript
      if (!m.transcriptText || m.transcriptText.length < 100) return false

      // Skip if analysis exists and is not failed
      if (m.analysisId && m.analysisStatus !== 'failed') return false

      // If failed analysis, only retry if more than 1 hour old
      if (m.analysisStatus === 'failed' && m.analysisCreatedAt) {
        const failedAt = new Date(m.analysisCreatedAt).getTime()
        const oneHourAgo = now.getTime() - 60 * 60 * 1000
        if (failedAt > oneHourAgo) return false
      }

      // Check if meeting ended recently (within last 30 minutes)
      const endTime = m.meetingEndTime || m.meetingTime
      if (!endTime) return false

      const meetingEnd = new Date(`${m.meetingDate}T${endTime}:00`)
      // If no explicit end time, assume 1 hour duration
      if (!m.meetingEndTime) {
        meetingEnd.setHours(meetingEnd.getHours() + 1)
      }

      return meetingEnd.toISOString() > thirtyMinutesAgo && meetingEnd < now
    })

    if (toAnalyze.length === 0) {
      return NextResponse.json({ ok: true, analyzed: 0, message: 'No eligible meetings' })
    }

    const analyzed: string[] = []
    const failed: Array<{ meetingId: string; error: string }> = []

    for (const meeting of toAnalyze) {
      try {
        const analysisId = 'ma_' + Date.now()
        const createdAt = now.toISOString()

        // Create analysis record
        await db.insert(meetingAnalyses).values({
          id: analysisId,
          meetingId: meeting.meetingId,
          meetingNoteId: meeting.noteId,
          source: 'notion_transcript',
          transcriptText: meeting.transcriptText,
          status: 'pending',
          createdAt,
          updatedAt: createdAt,
        })

        // Run analysis
        const result = await analyzeTranscript({
          transcriptText: meeting.transcriptText!,
          meetingTitle: meeting.meetingTitle,
          meetingDate: meeting.meetingDate,
        })

        // Update with results
        await db
          .update(meetingAnalyses)
          .set({
            hatName: result.hatName,
            topic: result.topic,
            mood: result.mood,
            subtext: result.subtext,
            keyInsight: result.keyInsight,
            score: result.score,
            scoreRationale: result.scoreRationale,
            kaizenKeep: result.kaizenKeep,
            kaizenImprove: result.kaizenImprove,
            openQuestion: result.openQuestion,
            participantsJson: JSON.stringify(result.participants),
            actionItemsJson: JSON.stringify(result.actionItems),
            model: 'gemini-2.5-flash',
            status: 'completed',
            updatedAt: now.toISOString(),
          })
          .where(eq(meetingAnalyses.id, analysisId))

        // Format and send message
        const message = formatAnalysisMessage(result, meeting.meetingTitle, meeting.meetingDate)

        await pushAssistantMessage(message, 'cron', { typeId: 'meeting_analysis' })

        analyzed.push(meeting.meetingId)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        failed.push({ meetingId: meeting.meetingId, error: errorMessage })

        // Mark as failed in DB
        const failedAnalysisId = 'ma_' + Date.now() + '_err'
        await db.insert(meetingAnalyses).values({
          id: failedAnalysisId,
          meetingId: meeting.meetingId,
          meetingNoteId: meeting.noteId,
          source: 'notion_transcript',
          transcriptText: meeting.transcriptText,
          status: 'failed',
          error: errorMessage,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }).catch(() => {
          // Ignore insert error if already exists
        })
      }
    }

    return NextResponse.json({
      ok: true,
      analyzed: analyzed.length,
      failed: failed.length,
      analyzedMeetings: analyzed,
      failedMeetings: failed,
    })
  } catch (err) {
    console.error('[cron/transcript-analysis]', err)
    const msg = err instanceof Error ? err.message : 'Transcript analysis failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
