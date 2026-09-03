import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

// Mock the analyzeTranscript service
vi.mock('../services/meeting-analysis', () => ({
  analyzeTranscript: vi.fn(async () => ({
    hatName: 'White Hat (עובדות וניתוח אובייקטיבי)',
    topic: 'תכנון ספרינט Q2',
    mood: 'ממוקד ומעט לחוץ',
    subtext: 'קיים לחץ עדין להשיג יעדים',
    keyInsight: 'הצוות מחפש בהירות לגבי סדרי עדיפויות',
    score: 7,
    scoreRationale: 'שיחה מעשית אבל חסרה תובנה מפתיעה',
    kaizenKeep: 'הקשבה טובה וסיכום נקודות פעולה',
    kaizenImprove: 'להקדיש זמן לחשיבה יצירתית',
    openQuestion: 'איך נוכל לשפר את היעילות בתקשורת הפנימית?',
    participants: [
      { name: 'אלפיר', confirmed: true },
      { name: 'דנה', confirmed: false },
    ],
    actionItems: [
      { content: 'לעדכן את הרואדמאפ עד יום רביעי', owner: 'אלפיר' },
      { content: 'לתאם פגישת המשך עם הצוות' },
    ],
  })),
}))

describe('meetings router — analyzeTranscript & getAnalysis', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('creates an analysis for a meeting with transcript', async () => {
    const caller = await createTestCaller()

    // Create a meeting
    const meeting = await caller.meetings.create({
      title: 'Sprint Planning',
      date: '2026-09-03',
      time: '10:00',
    })

    // Mock meeting note with transcript
    const { getDb, meetingNotes } = await import('@ak-system/database')
    const db = getDb()
    await db.insert(meetingNotes).values({
      id: 'mn_test',
      meetingId: meeting.id,
      title: 'Sprint Planning Notes',
      bodyText: 'This is a long transcript with at least 100 characters to pass validation. The team discussed priorities, timelines, and resource allocation for Q2 sprint.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Run analysis
    const result = await caller.meetings.analyzeTranscript({
      meetingId: meeting.id,
    })

    expect(result.status).toBe('completed')
    expect(result.hatName).toBe('White Hat (עובדות וניתוח אובייקטיבי)')

    // Verify analysis can be fetched
    const analysis = await caller.meetings.getAnalysis({
      meetingId: meeting.id,
    })

    expect(analysis).not.toBeNull()
    expect(analysis!.meetingId).toBe(meeting.id)
    expect(analysis!.status).toBe('completed')
    expect(analysis!.topic).toBe('תכנון ספרינט Q2')
    expect(analysis!.score).toBe(7)
    expect(analysis!.actionItems).toHaveLength(2)
  })

  it('returns null when no analysis exists', async () => {
    const caller = await createTestCaller()

    const meeting = await caller.meetings.create({
      title: 'Test Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const analysis = await caller.meetings.getAnalysis({
      meetingId: meeting.id,
    })

    expect(analysis).toBeNull()
  })

  it('throws error when transcript is too short', async () => {
    const caller = await createTestCaller()

    const meeting = await caller.meetings.create({
      title: 'Short Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const { getDb, meetingNotes } = await import('@ak-system/database')
    const db = getDb()
    await db.insert(meetingNotes).values({
      id: 'mn_short',
      meetingId: meeting.id,
      title: 'Short Notes',
      bodyText: 'Too short',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(
      caller.meetings.analyzeTranscript({ meetingId: meeting.id })
    ).rejects.toThrow('Transcript too short')
  })

  it('creates tasks from action items', async () => {
    const caller = await createTestCaller()

    // Create a meeting with analysis
    const meeting = await caller.meetings.create({
      title: 'Test Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const { getDb, meetingAnalyses } = await import('@ak-system/database')
    const db = getDb()
    const analysisId = 'ma_test'
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId: meeting.id,
      source: 'notion_transcript',
      status: 'completed',
      actionItemsJson: JSON.stringify([
        { content: 'פעולה ראשונה', owner: 'אלפיר' },
        { content: 'פעולה שנייה' },
      ]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Create tasks from first action item only
    await caller.meetings.createTasksFromAnalysis({
      analysisId,
      indices: [0],
    })

    const tasks = await caller.tasks.list()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('פעולה ראשונה')

    // Verify analysis was updated with task ID
    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    const actionItems = JSON.parse(analysis!.actionItemsJson!)
    expect(actionItems[0].taskId).toBeDefined()
    expect(actionItems[1].taskId).toBeUndefined()
  })

  it('creates all tasks when indices not specified', async () => {
    const caller = await createTestCaller()

    const meeting = await caller.meetings.create({
      title: 'Test Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const { getDb, meetingAnalyses } = await import('@ak-system/database')
    const db = getDb()
    const analysisId = 'ma_test2'
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId: meeting.id,
      source: 'notion_transcript',
      status: 'completed',
      actionItemsJson: JSON.stringify([
        { content: 'פעולה A' },
        { content: 'פעולה B' },
      ]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await caller.meetings.createTasksFromAnalysis({ analysisId })

    const tasks = await caller.tasks.list()
    expect(tasks).toHaveLength(2)
  })
})
