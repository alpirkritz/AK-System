import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestCaller, resetDb } from '../test-utils'
import { analyzeTranscript } from '../services/meeting-analysis'
import { ensureMeetingPageNote } from '../services/notion-meeting-note-body'

const TRANSCRIPT = '-Hello, Owen.\nHey.\nLet us go over the go-to-market plan and the pricing.\n'.repeat(5)

vi.mock('../services/meeting-analysis', () => ({
  analyzeTranscript: vi.fn(async () => ({
    hatName: 'Coach', topic: 'GTM', mood: 'ממוקד', subtext: '', keyInsight: 'תמחור', score: 8, scoreRationale: '',
    kaizenKeep: '', kaizenImprove: '', openQuestion: '', participants: [], actionItems: [],
  })),
}))

// Stand-in for the Notion round trip: the late AI notes land on the stored note.
vi.mock('../services/notion-meeting-note-body', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/notion-meeting-note-body')>()
  return {
    ...actual,
    ensureMeetingPageNote: vi.fn(async (db: ReturnType<typeof import('@ak-system/database').getDb>, pageId: string) => {
      const { meetingNotes } = await import('@ak-system/database')
      await db
        .update(meetingNotes)
        .set({ bodyText: 'Summary: GTM plan, pricing and payments discussed in depth with the team.', transcriptText: TRANSCRIPT })
        .where(eq(meetingNotes.notionPageId, pageId))
      return { error: null }
    }),
  }
})

const mockedAnalyze = vi.mocked(analyzeTranscript)
const mockedEnsure = vi.mocked(ensureMeetingPageNote)

async function seed(notionPageId: string | null) {
  const caller = await createTestCaller()
  const meeting = await caller.meetings.create({ title: 'Daz - Weekly', date: '2026-11-11', time: '17:30' })
  const { getDb, meetingNotes } = await import('@ak-system/database')
  const now = new Date().toISOString()
  await getDb().insert(meetingNotes).values({
    id: `mn_${meeting.id}`,
    meetingId: meeting.id,
    title: 'Daz - Weekly',
    bodyText: 'Daz - Weekly 2026-11-11T17:30:00.000+02:00',
    notionPageId,
    source: 'notion',
    sourceKind: 'meeting_page_summary',
    createdAt: now,
    updatedAt: now,
  })
  return { caller, meeting }
}

describe('meetings.analyzeTranscript — stale Notion AI notes', () => {
  beforeEach(async () => {
    await resetDb()
    mockedAnalyze.mockClear()
    mockedEnsure.mockClear()
  })

  it('re-fetches a title-only note from Notion and analyses the raw transcript', async () => {
    const { caller, meeting } = await seed('415e7d50-cb8e-81c9-8807-f918aa463a5b')

    const result = await caller.meetings.analyzeTranscript({ meetingId: meeting.id })

    expect(result.analysisId).toBeDefined()
    expect(mockedEnsure).toHaveBeenCalledWith(expect.anything(), '415e7d50-cb8e-81c9-8807-f918aa463a5b')
    expect(mockedAnalyze).toHaveBeenCalledTimes(1)
    expect(mockedAnalyze.mock.calls[0]![0].transcriptText).toBe(TRANSCRIPT.trim())
  })

  it('still fails clearly when the note has no Notion link to refresh from', async () => {
    const { caller, meeting } = await seed(null)

    await expect(caller.meetings.analyzeTranscript({ meetingId: meeting.id })).rejects.toThrow(
      'No transcript available or transcript too short',
    )
    expect(mockedEnsure).not.toHaveBeenCalled()
  })
})
