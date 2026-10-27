import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitments,
  meetingAnalyses,
  meetingPeople,
  meetings,
  people,
  projects,
  personEmailThreads,
  personExternalIds,
  tasks,
  voiceRecordings,
} from '@ak-system/database'
import { and, eq } from 'drizzle-orm'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { syncEmailThreads, gmailSearchQuery, type EmailHeaderMessage } from '../services/email-sync'
import {
  attachCandidates,
  attachVoiceRecording,
  localDateTime,
  hasTranscriptGaps,
  processVoiceRecording,
  saveVoiceUpload,
  VOICE_MAX_BYTES,
  VoiceUploadError,
} from '../services/voice'
import { commitmentSourceUrl, commitmentsForDate, proposeCommitmentsFromAnalysis } from '../services/commitments'
import { meetingPrepRelationship } from '../services/person-context'
import type { AnalysisResult } from '../services/meeting-analysis'

const NOW = new Date().toISOString()
const DAY = 86_400_000
const ACCOUNT = 'me@work.com'
let voiceDir = ''

beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-'))
  process.env.VOICE_STORAGE_DIR = voiceDir
})

afterAll(() => {
  fs.rmSync(voiceDir, { recursive: true, force: true })
  delete process.env.VOICE_STORAGE_DIR
})

async function seedPeople() {
  await getTestDb().insert(people).values([
    { id: 'p1', name: 'Dana Levi', email: 'dana@acme.com', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p2', name: 'Ron Cohen', email: null, status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p3', name: 'Guest Unconfirmed', email: 'guest@x.com', status: 'unconfirmed', source: 'calendar', createdAt: NOW },
  ])
  await getTestDb().insert(personExternalIds).values({
    id: 'pe1',
    personId: 'p2',
    provider: 'email',
    accountKey: 'default',
    externalId: 'ron@beta.io',
    createdAt: NOW,
    updatedAt: NOW,
  })
}

function mail(over: Partial<EmailHeaderMessage> & { messageId: string; threadId: string }): EmailHeaderMessage {
  return {
    accountEmail: ACCOUNT,
    subject: 'Q3 plan',
    from: `Me <${ACCOUNT}>`,
    to: 'Dana <dana@acme.com>',
    cc: '',
    date: new Date(Date.now() - DAY).toISOString(),
    snippet: 'hello',
    ...over,
  }
}

const fetcher = (messages: EmailHeaderMessage[]) => async () => ({ messages, accountErrors: [] })

function analysis(actionItems: { content: string; owner?: string }[]): AnalysisResult {
  return {
    hatName: 'Hat',
    topic: 'תכנון רבעון',
    mood: 'חיובי',
    subtext: '',
    keyInsight: 'סיכמנו על לוח זמנים',
    score: 8,
    scoreRationale: '',
    kaizenKeep: '',
    kaizenImprove: '',
    openQuestion: '',
    participants: [],
    actionItems,
  } as unknown as AnalysisResult
}

async function upload(personIds: string[] = ['p1'], meetingId?: string) {
  return saveVoiceUpload(getTestDb(), {
    audio: Buffer.from('fake-audio-bytes'),
    mimeType: 'audio/webm;codecs=opus',
    durationSeconds: 600,
    consentConfirmed: true,
    personIds,
    meetingId,
  })
}

describe('email archive', () => {
  beforeEach(async () => {
    await resetDb()
    await seedPeople()
  })

  it('builds one OR query per batch and archives threads per known person', async () => {
    expect(gmailSearchQuery(['a@x.com'], 30)).toBe('newer_than:30d {from:a@x.com to:a@x.com cc:a@x.com}')
    const db = getTestDb()
    const res = await syncEmailThreads(db, {
      fetch: fetcher([
        mail({ messageId: 'm1', threadId: 't1' }),
        mail({ messageId: 'm2', threadId: 't2', from: 'Ron <RON@beta.io>', to: ACCOUNT, cc: 'dana@acme.com' }),
        mail({ messageId: 'm3', threadId: 't3', from: 'stranger@nowhere.com', to: ACCOUNT }),
        mail({ messageId: 'm4', threadId: 't4', from: 'guest@x.com', to: ACCOUNT }),
      ]),
    })
    expect(res).toMatchObject({ people: 2, messages: 4, created: 3, updated: 0 })
    const rows = await db.select().from(personEmailThreads)
    expect(rows.map((r) => `${r.personId}:${r.gmailThreadId}`).sort()).toEqual([
      `p1:${ACCOUNT}::t1`,
      `p1:${ACCOUNT}::t2`,
      `p2:${ACCOUNT}::t2`,
    ])
  })

  it('updates a thread only when it has newer mail, and proposes commitments from new mail only', async () => {
    const db = getTestDb()
    const old = mail({ messageId: 'm1', threadId: 't1', snippet: "I'll send the deck tomorrow", date: new Date(Date.now() - 20 * DAY).toISOString() })
    await syncEmailThreads(db, { fetch: fetcher([old]) })
    expect(await db.select().from(commitments)).toHaveLength(0)

    const again = await syncEmailThreads(db, { fetch: fetcher([old]) })
    expect(again).toMatchObject({ created: 0, updated: 0 })

    const reply = mail({
      messageId: 'm2',
      threadId: 't1',
      from: 'Dana <dana@acme.com>',
      to: ACCOUNT,
      subject: 'Re: Q3 plan',
      snippet: 'Can you send the budget sheet?',
      date: new Date(Date.now() - DAY).toISOString(),
    })
    const res = await syncEmailThreads(db, { fetch: fetcher([old, reply]) })
    expect(res).toMatchObject({ created: 0, updated: 1 })
    const [thread] = await db.select().from(personEmailThreads)
    expect(thread).toMatchObject({ subject: 'Re: Q3 plan', messageCount: 2 })
    // Email heuristic commitment extraction was removed — syncEmailThreads no longer inserts commitments.
    expect(await db.select().from(commitments)).toHaveLength(0)
  })

  it('merging people moves email threads and recordings, dropping ones the kept person already has', async () => {
    const db = getTestDb()
    await syncEmailThreads(db, {
      fetch: fetcher([
        mail({ messageId: 'm1', threadId: 'shared', to: 'dana@acme.com, ron@beta.io' }),
        mail({ messageId: 'm2', threadId: 'only-dana' }),
      ]),
    })
    const { recordingId } = await upload(['p1', 'p2'])
    const caller = await createTestCaller()
    await caller.people.merge({ fromId: 'p1', toId: 'p2' })
    const threads = await db.select().from(personEmailThreads)
    expect(threads.map((t) => `${t.personId}:${t.gmailThreadId}`).sort()).toEqual([`p2:${ACCOUNT}::only-dana`, `p2:${ACCOUNT}::shared`])
    const list = await caller.voice.listForPerson({ personId: 'p2' })
    expect(list.recordings.map((r) => [r.id, r.people.map((p) => p.id)])).toEqual([[recordingId, ['p2']]])
  })

  it('exposes threads on the router and on the person card', async () => {
    await syncEmailThreads(getTestDb(), { fetch: fetcher([mail({ messageId: 'm1', threadId: 't1', snippet: 'Hi &amp; welcome' })]) })
    const caller = await createTestCaller()
    const { threads, hasMore } = await caller.email.threadsForPerson({ personId: 'p1' })
    expect(hasMore).toBe(false)
    expect(threads[0].gmailUrl).toContain('#all/t1')
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx.emailThreads).toHaveLength(1)
    expect(ctx.emailThreads[0]).toMatchObject({ subject: 'Q3 plan', snippet: 'Hi & welcome' })
  })
})

describe('voice capture', () => {
  beforeEach(async () => {
    await resetDb()
    await seedPeople()
  })

  it('rejects uploads without consent, too short, or of an unknown type', async () => {
    const db = getTestDb()
    const base = { audio: Buffer.from('x'), mimeType: 'audio/webm', durationSeconds: 60, consentConfirmed: true }
    await expect(saveVoiceUpload(db, { ...base, consentConfirmed: false })).rejects.toBeInstanceOf(VoiceUploadError)
    await expect(saveVoiceUpload(db, { ...base, durationSeconds: 5 })).rejects.toThrow('קצרה')
    await expect(saveVoiceUpload(db, { ...base, mimeType: 'video/mp4' })).rejects.toThrow('לא נתמך')
    expect(await db.select().from(voiceRecordings)).toHaveLength(0)
  })

  it('accepts a recording over the old 19MB inline cap, rejects only above the new app-level ceiling', async () => {
    const db = getTestDb()
    const overOldCap = Buffer.alloc(20 * 1024 * 1024) // 20MB — used to be a hard reject
    const { recordingId } = await saveVoiceUpload(db, {
      audio: overOldCap,
      mimeType: 'audio/webm',
      durationSeconds: 2400,
      consentConfirmed: true,
    })
    expect((await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId)))[0].sizeBytes).toBe(overOldCap.length)

    const tooBig = Buffer.alloc(VOICE_MAX_BYTES + 1)
    await expect(
      saveVoiceUpload(db, { audio: tooBig, mimeType: 'audio/webm', durationSeconds: 60, consentConfirmed: true }),
    ).rejects.toThrow('גדולה מדי')
  })

  it('accepts the mobile recorder format (AAC in MP4) as .m4a', async () => {
    const db = getTestDb()
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('m4a-bytes'),
      mimeType: 'audio/mp4',
      durationSeconds: 42,
      consentConfirmed: true,
      personIds: ['p1'],
    })
    const [stored] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(stored).toMatchObject({ mimeType: 'audio/mp4', duration: 42, status: 'uploaded' })
    expect(stored.audioPath.endsWith('.m4a')).toBe(true)
  })

  it('keeps the chosen project on the recording and on the meeting, and can clear it', async () => {
    const db = getTestDb()
    await db.insert(projects).values({ id: 'prj', name: 'Helm', source: 'manual', createdAt: NOW, updatedAt: NOW })
    const { recordingId } = await saveVoiceUpload(db, {
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
      durationSeconds: 60,
      consentConfirmed: true,
      personIds: ['p1'],
      projectId: 'missing',
    })
    expect((await db.select().from(voiceRecordings))[0].projectId).toBeNull()

    await db.update(voiceRecordings).set({ projectId: 'prj' }).where(eq(voiceRecordings.id, recordingId))
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'דובר 1: שלום',
      analyze: async () => analysis([]),
    })
    const [meeting] = await db.select().from(meetings)
    expect(meeting.projectId).toBe('prj')

    await attachVoiceRecording(db, { recordingId, personIds: ['p2'], projectId: null })
    expect((await db.select().from(voiceRecordings))[0].projectId).toBeNull()
    expect((await db.select().from(meetings))[0].projectId).toBeNull()
    const linked = await db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, meeting.id))
    expect(linked.map((l) => l.personId)).toEqual(['p2'])
  })

  it('stores the file, then analyzes a standalone recording into a placeholder meeting with voice commitments', async () => {
    const db = getTestDb()
    const { recordingId } = await upload(['p1'])
    const [stored] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(stored).toMatchObject({ status: 'uploaded', mimeType: 'audio/webm', duration: 600 })
    expect(stored.consentConfirmedAt).toBeTruthy()
    expect(fs.existsSync(stored.audioPath)).toBe(true)
    expect(stored.audioPath.startsWith(voiceDir)).toBe(true)

    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'דובר 1: שלום דנה',
      analyze: async () => analysis([{ content: 'לשלוח הצעת מחיר', owner: 'Dana Levi' }, { content: 'לבדוק תקציב' }]),
    })
    expect(rec).toMatchObject({ status: 'completed', transcriptText: 'דובר 1: שלום דנה' })
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))
    // Placeholder title is renamed from the analysis topic (recording-context-before-upload spec).
    expect(meeting).toMatchObject({ source: 'voice', title: 'תכנון רבעון' })
    expect(rec.createdMeetingId).toBe(meeting.id)
    expect(await db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, meeting.id))).toEqual([{ meetingId: meeting.id, personId: 'p1' }])
    const [a] = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId!))
    expect(a).toMatchObject({ source: 'voice', status: 'completed', audioPath: stored.audioPath })

    const cs = await db.select().from(commitments)
    expect(cs.map((c) => [c.owner, c.content, c.source, c.sourceId]).sort()).toEqual([
      ['me', 'לבדוק תקציב', 'voice', meeting.id],
      ['them', 'לשלוח הצעת מחיר', 'voice', meeting.id],
    ])

    const caller = await createTestCaller()
    const list = await caller.voice.listForPerson({ personId: 'p1' })
    expect(list.recordings[0]).toMatchObject({ id: recordingId, status: 'completed', topic: 'תכנון רבעון', people: [{ id: 'p1', name: 'Dana Levi' }] })
    const ctx = await caller.insights.personContext({ personId: 'p1' })
    expect(ctx.voiceRecordings.map((r) => r.id)).toEqual([recordingId])
    expect((await caller.voice.getAnalysis({ recordingId }))?.actionItems).toHaveLength(2)
  })

  it('keeps the failure on the recording and succeeds on retry', async () => {
    const db = getTestDb()
    const { recordingId } = await upload()
    const failed = await processVoiceRecording(db, recordingId, { transcribe: async () => { throw new Error('quota') } })
    expect(failed).toMatchObject({ status: 'failed', error: 'quota' })
    const ok = await processVoiceRecording(db, recordingId, { transcribe: async () => 'שיחה', analyze: async () => analysis([]) })
    expect(ok.status).toBe('completed')
    expect(await db.select().from(meetingAnalyses)).toHaveLength(1)
  })

  it('reuses a stored transcript on retry but re-transcribes when asked (long recording with failed chunks)', async () => {
    const db = getTestDb()
    const { recordingId } = await upload()
    const gappy = 'דובר 1: שלום\n[לא ניתן היה לתמלל את הקטע החל מ-20:00: quota]'
    expect(hasTranscriptGaps(gappy)).toBe(true)
    expect(hasTranscriptGaps('דובר 1: שלום')).toBe(false)
    const first = await processVoiceRecording(db, recordingId, { transcribe: async () => gappy, analyze: async () => analysis([]) })
    expect(first.transcriptText).toBe(gappy)

    // A plain retry keeps using the stored transcript.
    const transcribe = vi.fn(async () => 'דובר 1: שלום\nדובר 2: המשך השיחה המלאה')
    await processVoiceRecording(db, recordingId, { transcribe, analyze: async () => analysis([]) })
    expect(transcribe).not.toHaveBeenCalled()

    // retranscribe replaces it with a fresh transcript and a single, fresh analysis.
    const again = await processVoiceRecording(db, recordingId, { transcribe, analyze: async () => analysis([]), retranscribe: true })
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(again).toMatchObject({ status: 'completed', transcriptText: 'דובר 1: שלום\nדובר 2: המשך השיחה המלאה' })
    expect(await db.select().from(meetingAnalyses)).toHaveLength(1)
  })

  it('auto-attaches to the sole overlapping calendar meeting at process time, no placeholder created', async () => {
    const db = getTestDb()
    const local = localDateTime(Date.now() - 5 * 60_000)
    await db.insert(meetings).values({
      id: 'mtg', title: 'Weekly with Dana', date: local.date, time: '00:00', endTime: '23:59', source: 'calendar', createdAt: NOW, updatedAt: NOW,
    })
    const { recordingId } = await upload(['p1'])
    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'שיחה',
      analyze: async () => analysis([{ content: 'לשלוח הצעת מחיר', owner: 'Dana' }]),
    })
    expect(rec).toMatchObject({ meetingId: 'mtg', createdMeetingId: null, matchedAutomatically: true })
    expect(await db.select().from(meetings)).toHaveLength(1)
    const [a] = await db.select().from(meetingAnalyses)
    expect(a.meetingId).toBe('mtg')
    const [c] = await db.select().from(commitments)
    expect(c.sourceId).toBe('mtg')
  })

  it('manually attaching to a real meeting moves analysis, people and commitments and drops the placeholder', async () => {
    const db = getTestDb()
    const { recordingId } = await upload(['p1'])
    const rec = await processVoiceRecording(db, recordingId, {
      transcribe: async () => 'שיחה',
      analyze: async () => analysis([{ content: 'לשלוח הצעת מחיר', owner: 'Dana' }]),
    })
    expect(rec.matchedAutomatically).toBe(false)

    const local = localDateTime(Date.now() - 5 * 60_000)
    await db.insert(meetings).values({
      id: 'mtg', title: 'Weekly with Dana', date: local.date, time: '00:00', endTime: '23:59', source: 'calendar', createdAt: NOW, updatedAt: NOW,
    })
    expect((await attachCandidates(db, recordingId)).map((m) => m.id)).toEqual(['mtg'])

    const res = await attachVoiceRecording(db, { recordingId, personIds: ['p1', 'p2'], meetingId: 'mtg' })
    expect(res).toEqual({ attached: true, meetingId: 'mtg' })
    expect(await db.select().from(meetings).where(eq(meetings.id, rec.meetingId!))).toHaveLength(0)
    const [a] = await db.select().from(meetingAnalyses)
    expect(a.meetingId).toBe('mtg')
    const [c] = await db.select().from(commitments)
    expect(c.sourceId).toBe('mtg')
    expect((await db.select().from(meetingPeople).where(eq(meetingPeople.meetingId, 'mtg'))).map((r) => r.personId).sort()).toEqual(['p1', 'p2'])
    const [after] = await db.select().from(voiceRecordings)
    expect(after).toMatchObject({ meetingId: 'mtg', createdMeetingId: null })
  })
})

describe('shared commitment queue and Hugo', () => {
  beforeEach(async () => {
    await resetDb()
    await seedPeople()
  })

  async function meetingWith(id: string, date: string, personIds: string[], items: { content: string; owner?: string }[]) {
    const db = getTestDb()
    await db.insert(meetings).values({ id, title: `Meeting ${id}`, date, time: '10:00', source: 'calendar', createdAt: NOW, updatedAt: NOW })
    for (const personId of personIds) await db.insert(meetingPeople).values({ meetingId: id, personId })
    await db.insert(meetingAnalyses).values({
      id: `ma_${id}`, meetingId: id, source: 'notion_transcript', status: 'completed', actionItemsJson: JSON.stringify(items), createdAt: NOW, updatedAt: NOW,
    })
    return `ma_${id}`
  }

  it('assigns analysis items to the named attendee and skips owner-less items when several people attended', async () => {
    const db = getTestDb()
    const analysisId = await meetingWith('m1', '2026-09-01', ['p1', 'p2'], [
      { content: 'Ron sends the contract', owner: 'Ron' },
      { content: 'Someone checks legal' },
    ])
    expect(await proposeCommitmentsFromAnalysis(db, analysisId)).toBe(1)
    expect(await proposeCommitmentsFromAnalysis(db, analysisId)).toBe(0)
    const [c] = await db.select().from(commitments)
    expect(c).toMatchObject({ personId: 'p2', owner: 'them', source: 'meeting_analysis', sourceId: 'm1' })
  })

  it('morning brief lists today\'s attendees and my other open commitments once', async () => {
    const db = getTestDb()
    const today = '2026-09-24'
    await meetingWith('today', today, ['p1'], [{ content: 'Dana sends the deck', owner: 'Dana Levi' }, { content: 'I prepare the agenda' }])
    await proposeCommitmentsFromAnalysis(db, 'ma_today')
    await db.insert(commitments).values({
      id: 'c_ron', personId: 'p2', owner: 'me', content: 'להחזיר לרון תשובה', source: 'whatsapp_dm', status: 'proposed', createdAt: NOW, updatedAt: NOW,
    })
    const res = await commitmentsForDate(db, today)
    expect(res.byPerson).toHaveLength(1)
    expect(res.byPerson[0].personName).toBe('Dana Levi')
    expect(res.byPerson[0].items.map((i) => i.owner).sort()).toEqual(['me', 'them'])
    expect(res.mine.map((m) => m.content)).toEqual(['להחזיר לרון תשובה'])
    const caller = await createTestCaller()
    expect(await caller.insights.commitmentsForDate({ date: today })).toEqual(res)
  })

  it('meeting prep labels each commitment by source and never quotes the snippet', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({ id: 'prep', title: 'Prep', date: '2026-09-24', time: '10:00', source: 'calendar', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values({ meetingId: 'prep', personId: 'p1' })
    await db.insert(commitments).values({
      id: 'c1', personId: 'p1', owner: 'them', content: 'לשלוח מצגת', source: 'email', sourceId: `${ACCOUNT}::t1`,
      sourceSnippet: 'SECRET RAW QUOTE', status: 'proposed', createdAt: NOW, updatedAt: NOW,
    })
    const prep = await meetingPrepRelationship(db, 'prep')
    expect(prep.lines).toContain('Dana Levi · התחייבות פתוחה (מאימייל): Dana Levi – לשלוח מצגת')
    expect(prep.lines.join('\n')).not.toContain('SECRET RAW QUOTE')
  })

  it('lists source links and ties an accepted voice commitment\'s task to its meeting', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({ id: 'mv', title: 'Voice', date: '2026-09-24', time: '10:00', source: 'voice', createdAt: NOW, updatedAt: NOW })
    await db.insert(commitments).values([
      { id: 'cv', personId: 'p1', owner: 'them', content: 'לשלוח חוזה', source: 'voice', sourceId: 'mv', status: 'proposed', createdAt: NOW, updatedAt: NOW },
      { id: 'cw', personId: 'p1', owner: 'me', content: 'לענות', source: 'whatsapp_dm', sourceId: 'wa1', status: 'proposed', createdAt: NOW, updatedAt: NOW },
    ])
    const caller = await createTestCaller()
    const list = await caller.commitments.listProposed()
    expect(Object.fromEntries(list.map((c) => [c.id, c.sourceUrl]))).toEqual({ cv: '/meetings/mv', cw: null })
    const { taskId } = await caller.commitments.accept({ commitmentId: 'cv' })
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
    expect(task).toMatchObject({ meetingId: 'mv', assigneeId: 'p1', title: 'לשלוח חוזה' })
    expect(await db.select().from(commitments).where(and(eq(commitments.id, 'cv'), eq(commitments.status, 'accepted')))).toHaveLength(1)
  })
})
