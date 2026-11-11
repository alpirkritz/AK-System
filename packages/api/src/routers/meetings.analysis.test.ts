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

describe('meetings router — analysis attendees', () => {
  beforeEach(async () => {
    await resetDb()
    mockedAnalyze.mockClear()
  })

  async function analyzed() {
    const { caller, meeting } = await seedMeetingWithTranscript('Attendees')
    const started = await caller.meetings.analyzeTranscript({ meetingId: meeting.id })
    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    return { caller, meeting, analysisId: started.analysisId, analysis: analysis! }
  }

  it('does not suggest the owner as someone to add', async () => {
    const { analysis } = await analyzed()
    expect(analysis.participants.map((person) => person.name)).toEqual(['דנה'])
  })

  it('creates a confirmed person and attaches them to the meeting', async () => {
    const { caller, meeting, analysisId } = await analyzed()
    const result = await caller.meetings.acceptAnalysisParticipant({
      analysisId,
      participantIndex: 0,
    })

    expect(result.created).toBe(true)
    expect(result.name).toBe('דנה')

    const listed = await caller.people.list()
    expect(listed.some((person) => person.id === result.personId && person.status === 'confirmed')).toBe(true)

    const refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds).toContain(result.personId)

    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    expect(analysis?.participants[0]).toMatchObject({
      name: 'דנה',
      personId: result.personId,
      confirmed: true,
    })
  })

  it('reuses an existing person instead of creating a duplicate', async () => {
    const { caller, meeting, analysisId } = await analyzed()
    const existing = await caller.people.create({ name: 'דנה' })
    const result = await caller.meetings.acceptAnalysisParticipant({
      analysisId,
      participantIndex: 0,
    })

    expect(result.created).toBe(false)
    expect(result.personId).toBe(existing.id)
    const listed = await caller.people.list()
    expect(listed.filter((person) => person.name === 'דנה')).toHaveLength(1)
    const refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds).toContain(existing.id)
  })

  it('asks for an explicit pick when two contacts share a name', async () => {
    const { caller, analysisId } = await analyzed()
    const { getDb, people } = await import('@ak-system/database')
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values([
      { id: 'p_dana_a', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: now },
      { id: 'p_dana_b', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: now },
    ])

    await expect(
      caller.meetings.acceptAnalysisParticipant({ analysisId, participantIndex: 0 }),
    ).rejects.toThrow(/כמה אנשי קשר/)
  })

  it('removes a suggestion and the meeting link without deleting the contact', async () => {
    const { caller, meeting, analysisId } = await analyzed()
    const added = await caller.meetings.acceptAnalysisParticipant({
      analysisId,
      participantIndex: 0,
    })
    await caller.meetings.removeAnalysisParticipant({ analysisId, participantIndex: 0 })

    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    expect(analysis?.participants.map((person) => person.name)).toEqual([])
    const refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds ?? []).not.toContain(added.personId)
    const listed = await caller.people.list()
    expect(listed.some((person) => person.id === added.personId)).toBe(true)
  })

  it('attachPerson and detachPerson keep the contact in אנשים', async () => {
    const { caller, meeting } = await analyzed()
    const attached = await caller.meetings.attachPerson({ meetingId: meeting.id, name: 'יוסי' })
    expect(attached.created).toBe(true)
    let refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds).toContain(attached.personId)

    await caller.meetings.detachPerson({ meetingId: meeting.id, personId: attached.personId })
    refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds ?? []).not.toContain(attached.personId)
    const listed = await caller.people.list()
    expect(listed.some((person) => person.id === attached.personId)).toBe(true)
  })

  it('keeps Notion-linked attendees and removes only the one that is wrong', async () => {
    const { caller, meeting, analysisId } = await analyzed()
    const { getDb, people, meetingPeople } = await import('@ak-system/database')
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values([
      {
        id: 'p_notion_dana',
        name: 'דנה',
        status: 'confirmed',
        source: 'notion',
        notionPageId: 'notion-dana',
        createdAt: now,
      },
      {
        id: 'p_notion_yosi',
        name: 'יוסי',
        status: 'confirmed',
        source: 'notion',
        notionPageId: 'notion-yosi',
        createdAt: now,
      },
    ])
    await db.insert(meetingPeople).values([
      { meetingId: meeting.id, personId: 'p_notion_dana' },
      { meetingId: meeting.id, personId: 'p_notion_yosi' },
    ])

    await caller.meetings.acceptAnalysisParticipant({ analysisId, participantIndex: 0 })
    let refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds).toEqual(expect.arrayContaining(['p_notion_dana', 'p_notion_yosi']))

    await caller.meetings.removeAnalysisParticipant({ analysisId, participantIndex: 0 })
    refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds ?? []).not.toContain('p_notion_dana')
    expect(refreshed?.peopleIds).toContain('p_notion_yosi')

    const listed = await caller.people.list()
    expect(listed.some((person) => person.id === 'p_notion_dana' && person.notionPageId === 'notion-dana')).toBe(true)
  })

  it('relinking a suggestion replaces only that attendee', async () => {
    const { caller, meeting, analysisId } = await analyzed()
    const { getDb, people, meetingPeople } = await import('@ak-system/database')
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values([
      {
        id: 'p_notion_dana',
        name: 'דנה',
        status: 'confirmed',
        source: 'notion',
        notionPageId: 'notion-dana',
        createdAt: now,
      },
      {
        id: 'p_notion_yosi',
        name: 'יוסי',
        status: 'confirmed',
        source: 'notion',
        notionPageId: 'notion-yosi',
        createdAt: now,
      },
      {
        id: 'p_noa',
        name: 'נועה',
        status: 'confirmed',
        source: 'manual',
        createdAt: now,
      },
    ])
    await db.insert(meetingPeople).values([
      { meetingId: meeting.id, personId: 'p_notion_dana' },
      { meetingId: meeting.id, personId: 'p_notion_yosi' },
    ])

    await caller.meetings.acceptAnalysisParticipant({
      analysisId,
      participantIndex: 0,
      personId: 'p_noa',
    })

    const refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds).toContain('p_noa')
    expect(refreshed?.peopleIds).toContain('p_notion_yosi')
    expect(refreshed?.peopleIds ?? []).not.toContain('p_notion_dana')
    const listed = await caller.people.list()
    expect(listed.some((person) => person.id === 'p_notion_dana')).toBe(true)
  })

  it('linkAnalysisParticipant writes meeting_people', async () => {
    const { caller, meeting, analysisId } = await analyzed()
    const person = await caller.people.create({ name: 'נועה' })
    await caller.meetings.linkAnalysisParticipant({
      analysisId,
      participantIndex: 0,
      personId: person.id,
    })
    const refreshed = await caller.meetings.getById({ id: meeting.id })
    expect(refreshed?.peopleIds).toContain(person.id)
    const analysis = await caller.meetings.getAnalysis({ meetingId: meeting.id })
    expect(analysis?.participants[0]?.personId).toBe(person.id)
  })
})
