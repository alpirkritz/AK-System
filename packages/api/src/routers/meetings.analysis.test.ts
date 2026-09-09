import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'
import { analyzeTranscript } from '../services/meeting-analysis'

const mockedAnalyze = vi.mocked(analyzeTranscript)

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

async function seedMeetingWithTranscript(title = 'Sprint Planning') {
  const caller = await createTestCaller()
  const meeting = await caller.meetings.create({
    title,
    date: '2026-09-03',
    time: '10:00',
  })

  const { getDb, meetingNotes } = await import('@ak-system/database')
  const db = getDb()
  await db.insert(meetingNotes).values({
    id: `mn_${meeting.id}`,
    meetingId: meeting.id,
    title: `${title} Notes`,
    bodyText:
      'This is a long transcript with at least 100 characters to pass validation. The team discussed priorities, timelines, and resource allocation for Q2 sprint.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  return { caller, meeting }
}

describe('meetings router — analyzeTranscript & getAnalysis', () => {
  beforeEach(async () => {
    await resetDb()
    mockedAnalyze.mockClear()
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

    expect(result.analysisId).toBeDefined()

    // Verify analysis can be fetched
    const analysis = await caller.meetings.getAnalysis({
      meetingId: meeting.id,
    })

    expect(analysis).not.toBeNull()
    expect(analysis!.status).toBe('completed')
    expect(analysis!.hatName).toBe('White Hat (עובדות וניתוח אובייקטיבי)')
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
    ).rejects.toThrow('No transcript available or transcript too short')
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
    expect(analysis).not.toBeNull()
    expect(analysis!.actionItems[0].taskId).toBeDefined()
    expect(analysis!.actionItems[1].taskId).toBeUndefined()
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

  it('links task IDs to action items', async () => {
    const caller = await createTestCaller()

    const meeting = await caller.meetings.create({
      title: 'Test Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const { getDb, meetingAnalyses } = await import('@ak-system/database')
    const db = getDb()
    const analysisId = 'ma_link_test'
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId: meeting.id,
      source: 'notion_transcript',
      status: 'completed',
      actionItemsJson: JSON.stringify([
        { content: 'פעולה ראשונה' },
        { content: 'פעולה שנייה' },
      ]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Link first action item
    const result = await caller.meetings.linkActionItemTasks({
      analysisId,
      links: [{ actionItemIndex: 0, taskId: 't_123' }],
    })

    expect(result.linked).toBe(1)

    // Verify analysis was updated
    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    expect(analysis).not.toBeNull()
    expect(analysis!.actionItems[0].taskId).toBe('t_123')
    expect(analysis!.actionItems[1].taskId).toBeUndefined()
  })

  it('links multiple task IDs at once', async () => {
    const caller = await createTestCaller()

    const meeting = await caller.meetings.create({
      title: 'Test Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const { getDb, meetingAnalyses } = await import('@ak-system/database')
    const db = getDb()
    const analysisId = 'ma_multi_link'
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId: meeting.id,
      source: 'notion_transcript',
      status: 'completed',
      actionItemsJson: JSON.stringify([
        { content: 'A' },
        { content: 'B' },
        { content: 'C' },
      ]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const result = await caller.meetings.linkActionItemTasks({
      analysisId,
      links: [
        { actionItemIndex: 0, taskId: 't_a' },
        { actionItemIndex: 2, taskId: 't_c' },
      ],
    })

    expect(result.linked).toBe(2)

    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    expect(analysis!.actionItems[0].taskId).toBe('t_a')
    expect(analysis!.actionItems[1].taskId).toBeUndefined()
    expect(analysis!.actionItems[2].taskId).toBe('t_c')
  })

  it('rejects invalid action item index', async () => {
    const caller = await createTestCaller()

    const meeting = await caller.meetings.create({
      title: 'Test Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const { getDb, meetingAnalyses } = await import('@ak-system/database')
    const db = getDb()
    const analysisId = 'ma_invalid_idx'
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId: meeting.id,
      source: 'notion_transcript',
      status: 'completed',
      actionItemsJson: JSON.stringify([{ content: 'פעולה' }]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(
      caller.meetings.linkActionItemTasks({
        analysisId,
        links: [{ actionItemIndex: 5, taskId: 't_bad' }],
      })
    ).rejects.toThrow('Invalid action item index')
  })

  it('skips linking when taskId already matches', async () => {
    const caller = await createTestCaller()

    const meeting = await caller.meetings.create({
      title: 'Test Meeting',
      date: '2026-09-03',
      time: '10:00',
    })

    const { getDb, meetingAnalyses } = await import('@ak-system/database')
    const db = getDb()
    const analysisId = 'ma_skip_test'
    await db.insert(meetingAnalyses).values({
      id: analysisId,
      meetingId: meeting.id,
      source: 'notion_transcript',
      status: 'completed',
      actionItemsJson: JSON.stringify([{ content: 'פעולה', taskId: 't_existing' }]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const result = await caller.meetings.linkActionItemTasks({
      analysisId,
      links: [{ actionItemIndex: 0, taskId: 't_existing' }],
    })

    expect(result.linked).toBe(0) // Nothing linked because already set
  })

  it('returns the existing analysis without calling Gemini when force is false', async () => {
    const { caller, meeting } = await seedMeetingWithTranscript()

    const first = await caller.meetings.analyzeTranscript({ meetingId: meeting.id })
    expect(mockedAnalyze).toHaveBeenCalledTimes(1)

    const second = await caller.meetings.analyzeTranscript({
      meetingId: meeting.id,
      force: false,
    })

    expect(second.analysisId).toBe(first.analysisId)
    expect(mockedAnalyze).toHaveBeenCalledTimes(1)
  })

  it('creates a new analysis when force is true', async () => {
    const { caller, meeting } = await seedMeetingWithTranscript('Force Reanalyze')

    const first = await caller.meetings.analyzeTranscript({ meetingId: meeting.id })
    expect(mockedAnalyze).toHaveBeenCalledTimes(1)

    const second = await caller.meetings.analyzeTranscript({
      meetingId: meeting.id,
      force: true,
    })

    expect(second.analysisId).not.toBe(first.analysisId)
    expect(mockedAnalyze).toHaveBeenCalledTimes(2)

    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    expect(analysis).not.toBeNull()
    expect(analysis!.id).toBe(second.analysisId)
    expect(analysis!.status).toBe('completed')
  })

  it('retries a failed analysis when force is true', async () => {
    const { caller, meeting } = await seedMeetingWithTranscript('Failed Retry')
    const { getDb, meetingAnalyses } = await import('@ak-system/database')
    const db = getDb()
    const failedId = `ma_failed_${meeting.id}`
    await db.insert(meetingAnalyses).values({
      id: failedId,
      meetingId: meeting.id,
      source: 'notion_transcript',
      status: 'failed',
      error: 'Gemini timeout',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const skipped = await caller.meetings.analyzeTranscript({
      meetingId: meeting.id,
      force: false,
    })
    expect(skipped.analysisId).toBe(failedId)
    expect(mockedAnalyze).not.toHaveBeenCalled()

    const retried = await caller.meetings.analyzeTranscript({
      meetingId: meeting.id,
      force: true,
    })

    expect(retried.analysisId).not.toBe(failedId)
    expect(mockedAnalyze).toHaveBeenCalledTimes(1)

    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    expect(analysis!.id).toBe(retried.analysisId)
    expect(analysis!.status).toBe('completed')
  })
})
