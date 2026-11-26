/**
 * docs/specs/recording-uses-chosen-people.md — the people chosen before upload name the speakers and
 * the people in the analysis. Gemini is always faked here (attributor + analyzer); no network.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  commitments,
  meetingAnalyses,
  meetingPeople,
  meetings,
  notifications,
  people,
  personAliases,
  voiceRecordings,
  voiceSpeakerIdentities,
  voiceTranscriptSegments,
} from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { processVoiceRecording, refreshVoiceAnalysisAfterSpeakerResolution, saveVoiceUpload } from './voice'
import {
  attributeSpeakersFromCandidates,
  identifySpeaker,
  listRecordingSpeakers,
  type SpeakerAttributionInput,
  type SpeakerAttributor,
} from './voice-diarization'
import type { AnalysisResult, AnalyzeTranscriptOptions } from './meeting-analysis'
import { ensureSelfPerson } from './self-person'
import { proposeCommitmentsFromAnalysis } from './commitments'
import { resolveCandidate } from './people-resolve'

/** Action items now carry their commitment's id (commitment-task-linking); compare the rest. */
function withoutLinks(json: string): unknown[] {
  return (JSON.parse(json) as Record<string, unknown>[]).map(({ commitmentId: _c, ...rest }) => rest)
}

let voiceDir = ''

beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-chosen-'))
  process.env.VOICE_STORAGE_DIR = voiceDir
})

afterAll(() => {
  fs.rmSync(voiceDir, { recursive: true, force: true })
  delete process.env.VOICE_STORAGE_DIR
})

const NOW = new Date().toISOString()

/** Three speakers; דובר 1 addresses Omri by his Hebrew first name. */
const THREE_SPEAKERS = JSON.stringify([
  { speaker: 'דובר 1', start: 0, end: 4, text: 'עומרי, מה אתה אומר על הלוח זמנים?' },
  { speaker: 'דובר 2', start: 4, end: 9, text: 'אני אשלח את התוכנית עד יום חמישי' },
  { speaker: 'דובר 3', start: 9, end: 14, text: 'ואני אבדוק את התקציב' },
])

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    hatName: 'Hat',
    topic: 'שיחה',
    mood: '',
    subtext: '',
    keyInsight: '',
    score: 5,
    scoreRationale: '',
    kaizenKeep: '',
    kaizenImprove: '',
    openQuestion: '',
    participants: [],
    actionItems: [],
    ...overrides,
  }
}

async function seedPeople() {
  await getTestDb().insert(people).values([
    { id: 'p_omri', name: 'Omri Ben Simon', role: 'CTO', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p_dana', name: 'דנה לוי', status: 'confirmed', source: 'manual', createdAt: NOW },
    { id: 'p_other', name: 'Someone Else', status: 'confirmed', source: 'manual', createdAt: NOW },
  ])
}

async function upload(personIds: string[]): Promise<string> {
  const { recordingId } = await saveVoiceUpload(getTestDb(), {
    audio: Buffer.from('x'),
    mimeType: 'audio/webm',
    durationSeconds: 600,
    consentConfirmed: true,
    personIds,
  })
  return recordingId
}

function fakeAttributor(answer: (input: SpeakerAttributionInput) => Record<string, string | null>) {
  const calls: SpeakerAttributionInput[] = []
  const fn: SpeakerAttributor = async (input) => {
    calls.push(input)
    return answer(input)
  }
  return { fn, calls }
}

/** Processed recording with segments in place but the attribution pass skipped. */
async function processedRecording(personIds: string[]): Promise<string> {
  const recordingId = await upload(personIds)
  await processVoiceRecording(getTestDb(), recordingId, {
    transcribe: async () => THREE_SPEAKERS,
    analyze: async () => analysis(),
    attributeSpeakers: async () => ({}),
  })
  return recordingId
}

async function identities(recordingId: string) {
  return getTestDb().select().from(voiceSpeakerIdentities).where(eq(voiceSpeakerIdentities.recordingId, recordingId))
}

beforeEach(async () => {
  await resetDb()
  await getTestDb().delete(notifications)
  await seedPeople()
})

describe('attributeSpeakersFromCandidates', () => {
  it('names three speakers from the chosen people: by address and by elimination', async () => {
    const db = getTestDb()
    const owner = await ensureSelfPerson(db)
    const recordingId = await processedRecording(['p_omri', 'p_dana'])
    const fake = fakeAttributor(() => ({ 'דובר 1': owner.id, 'דובר 2': 'p_omri', 'דובר 3': 'p_dana' }))

    expect(await attributeSpeakersFromCandidates(db, recordingId, fake.fn)).toBe(3)

    expect(fake.calls).toHaveLength(1)
    const [input] = fake.calls
    expect(input.labels).toEqual(['דובר 1', 'דובר 2', 'דובר 3'])
    expect(input.candidates.map((c) => c.id).sort()).toEqual([owner.id, 'p_dana', 'p_omri'].sort())
    expect(input.candidates.find((c) => c.id === owner.id)?.isOwner).toBe(true)
    expect(input.candidates.find((c) => c.id === 'p_omri')?.role).toBe('CTO')
    expect(input.turns[0]).toEqual({ speakerLabel: 'דובר 1', text: 'עומרי, מה אתה אומר על הלוח זמנים?' })

    const speakers = await listRecordingSpeakers(db, recordingId)
    expect(speakers.map((s) => [s.speakerLabel, s.state, s.personName])).toEqual([
      ['דובר 1', 'auto', owner.name],
      ['דובר 2', 'auto', 'Omri Ben Simon'],
      ['דובר 3', 'auto', 'דנה לוי'],
    ])
  })

  it('leaves both labels unknown when the same person is given to two of them', async () => {
    const db = getTestDb()
    const recordingId = await processedRecording(['p_omri', 'p_dana'])
    const fake = fakeAttributor(() => ({ 'דובר 2': 'p_omri', 'דובר 3': 'p_omri', 'דובר 1': null }))

    expect(await attributeSpeakersFromCandidates(db, recordingId, fake.fn)).toBe(0)
    expect(await identities(recordingId)).toHaveLength(0)
  })

  it('never overwrites a hand-made answer and never offers a person already assigned', async () => {
    const db = getTestDb()
    const recordingId = await processedRecording(['p_omri', 'p_dana'])
    await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 2', personId: 'p_omri' })
    await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 1', personId: null })
    const fake = fakeAttributor(() => ({ 'דובר 2': 'p_dana', 'דובר 1': 'p_dana', 'דובר 3': 'p_dana' }))

    expect(await attributeSpeakersFromCandidates(db, recordingId, fake.fn)).toBe(1)

    expect(fake.calls[0].labels).toEqual(['דובר 3'])
    expect(fake.calls[0].candidates.map((c) => c.id)).not.toContain('p_omri')
    const rows = await identities(recordingId)
    expect(rows.find((r) => r.speakerLabel === 'דובר 2')).toMatchObject({ state: 'identified', personId: 'p_omri' })
    expect(rows.find((r) => r.speakerLabel === 'דובר 1')).toMatchObject({ state: 'skipped', personId: null })
    expect(rows.find((r) => r.speakerLabel === 'דובר 3')).toMatchObject({ state: 'auto', personId: 'p_dana' })
  })

  it('ignores an answer that is not a candidate', async () => {
    const db = getTestDb()
    const recordingId = await processedRecording(['p_omri'])
    const fake = fakeAttributor(() => ({ 'דובר 2': 'p_other', 'דובר 3': 'p_ghost' }))
    expect(await attributeSpeakersFromCandidates(db, recordingId, fake.fn)).toBe(0)
    expect(await identities(recordingId)).toHaveLength(0)
  })

  it('makes no call when nobody was chosen before upload', async () => {
    const db = getTestDb()
    const recordingId = await processedRecording([])
    const fake = fakeAttributor(() => ({ 'דובר 2': 'p_omri' }))
    expect(await attributeSpeakersFromCandidates(db, recordingId, fake.fn)).toBe(0)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('the "who is speaking" prompt after attribution', () => {
  it('asks nothing when the chosen people resolved every speaker', async () => {
    const db = getTestDb()
    const owner = await ensureSelfPerson(db)
    const recordingId = await upload(['p_omri', 'p_dana'])
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => THREE_SPEAKERS,
      analyze: async () => analysis(),
      attributeSpeakers: async () => ({ 'דובר 1': owner.id, 'דובר 2': 'p_omri', 'דובר 3': 'p_dana' }),
    })

    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(rec.status).toBe('completed')
    expect(rec.speakerPromptSentAt).toBeNull()
    expect(await db.select().from(notifications)).toHaveLength(0)
    expect((await listRecordingSpeakers(db, recordingId)).every((s) => s.state === 'auto')).toBe(true)
  })

  it('says how many are left when one speaker is still unknown', async () => {
    const db = getTestDb()
    const owner = await ensureSelfPerson(db)
    const recordingId = await upload(['p_omri', 'p_dana'])
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => THREE_SPEAKERS,
      analyze: async () => analysis(),
      attributeSpeakers: async () => ({ 'דובר 1': owner.id, 'דובר 2': 'p_omri', 'דובר 3': null }),
    })

    const sent = await db.select().from(notifications)
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe('מי מדבר בהקלטה?')
    expect(sent[0].body).toContain('נשאר דובר אחד שלא זוהה (דובר 3)')
  })

  it('exposes `candidate` on voice.speakers', async () => {
    const caller = await createTestCaller()
    const recordingId = await upload(['p_omri'])
    await processVoiceRecording(getTestDb(), recordingId, {
      transcribe: async () => THREE_SPEAKERS,
      analyze: async () => analysis(),
      attributeSpeakers: async () => ({ 'דובר 2': 'p_omri' }),
    })
    const speakers = await caller.voice.speakers({ recordingId })
    expect(speakers.find((s) => s.speakerLabel === 'דובר 2')).toMatchObject({ personId: 'p_omri', candidate: true })
    expect(speakers.find((s) => s.speakerLabel === 'דובר 3')).toMatchObject({ personId: null, candidate: false })
  })
})

describe('names in the analysis', () => {
  it('writes the People name for "עומרי", links it, learns the alias, and drops a non-candidate id', async () => {
    const db = getTestDb()
    const recordingId = await upload(['p_omri', 'p_dana'])
    let seen: AnalyzeTranscriptOptions | null = null
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => THREE_SPEAKERS,
      attributeSpeakers: async () => ({}),
      analyze: async (options) => {
        seen = options
        return analysis({
          participants: [
            { name: 'עומרי', confirmed: true, personId: 'p_omri' },
            { name: 'דנה', confirmed: true },
            { name: 'אורח', confirmed: false, personId: 'p_other' },
          ],
          actionItems: [
            { content: 'לשלוח את התוכנית', owner: 'עומרי', personId: 'p_omri' },
            { content: 'לבדוק תקציב', owner: 'דנה' },
            { content: 'לתאם פגישה', owner: 'אורח', personId: 'p_ghost' },
          ],
        })
      },
    })

    expect(seen!.candidates?.map((c) => c.id)).toEqual(expect.arrayContaining(['p_omri', 'p_dana']))
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const [stored] = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId!))
    expect(JSON.parse(stored.participantsJson!)).toEqual([
      { name: 'Omri Ben Simon', confirmed: true, personId: 'p_omri' },
      { name: 'דנה לוי', confirmed: true, personId: 'p_dana' },
      { name: 'אורח', confirmed: false },
    ])
    expect(withoutLinks(stored.actionItemsJson!)).toEqual([
      { content: 'לשלוח את התוכנית', owner: 'Omri Ben Simon', personId: 'p_omri' },
      { content: 'לבדוק תקציב', owner: 'דנה לוי', personId: 'p_dana' },
      { content: 'לתאם פגישה', owner: 'אורח' },
    ])

    // Only the cross-script form the deterministic match couldn't catch is learned.
    const aliases = await db.select().from(personAliases)
    expect(aliases.map((a) => [a.personId, a.alias])).toEqual([['p_omri', 'עומרי']])

    // The action item reaches Omri's commitments.
    const theirs = await db.select().from(commitments).where(eq(commitments.personId, 'p_omri'))
    expect(theirs.map((c) => [c.owner, c.content])).toEqual([['them', 'לשלוח את התוכנית']])

    // The router returns the linked People name.
    const caller = await createTestCaller()
    const view = await caller.voice.getAnalysis({ recordingId })
    expect(view?.actionItems[0]).toMatchObject({ personId: 'p_omri', personName: 'Omri Ben Simon' })
  })

  it('uses the spoken form the model reports when it already wrote the canonical name', async () => {
    const db = getTestDb()
    const recordingId = await upload(['p_omri'])
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => THREE_SPEAKERS,
      attributeSpeakers: async () => ({}),
      analyze: async () =>
        analysis({
          actionItems: [{ content: 'לשלוח', owner: 'Omri Ben Simon', personId: 'p_omri', ownerSpokenAs: 'עומרי' }],
        }),
    })
    const aliases = await db.select().from(personAliases).where(eq(personAliases.personId, 'p_omri'))
    expect(aliases.map((a) => a.alias)).toEqual(['עומרי'])
  })

  it('keeps an analysis with no chosen people as it was (no candidates, no personId)', async () => {
    const db = getTestDb()
    const recordingId = await upload([])
    let seen: AnalyzeTranscriptOptions | null = null
    await processVoiceRecording(db, recordingId, {
      transcribe: async () => THREE_SPEAKERS,
      analyze: async (options) => {
        seen = options
        return analysis({ actionItems: [{ content: 'לשלוח', owner: 'Omri Ben Simon' }] })
      },
    })
    expect(seen!.candidates).toBeUndefined()
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const [stored] = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId!))
    expect(withoutLinks(stored.actionItemsJson!)).toEqual([{ content: 'לשלוח', owner: 'Omri Ben Simon' }])
  })

  it('the refresh after naming speakers goes through the same linking', async () => {
    const db = getTestDb()
    const owner = await ensureSelfPerson(db)
    const recordingId = await processedRecording(['p_omri', 'p_dana'])
    await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 1', personId: owner.id })
    await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 2', personId: 'p_omri' })
    await identifySpeaker(db, { recordingId, speakerLabel: 'דובר 3', personId: 'p_dana' })

    const refreshed = await refreshVoiceAnalysisAfterSpeakerResolution(db, recordingId, {
      analyze: async () => analysis({ actionItems: [{ content: 'לשלוח', owner: 'עומרי', personId: 'p_omri' }] }),
    })
    expect(refreshed).toBe(true)
    const [rec] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    const [stored] = await db.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, rec.analysisId!))
    expect(withoutLinks(stored.actionItemsJson!)).toEqual([{ content: 'לשלוח', owner: 'Omri Ben Simon', personId: 'p_omri' }])
  })
})

describe('commitments prefer personId', () => {
  it('routes an item to its linked person even when the owner name matches nobody', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({ id: 'm1', title: 'פגישה', date: NOW.slice(0, 10), createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values([
      { meetingId: 'm1', personId: 'p_omri' },
      { meetingId: 'm1', personId: 'p_dana' },
    ])
    await db.insert(meetingAnalyses).values({
      id: 'ma1',
      meetingId: 'm1',
      source: 'voice',
      transcriptText: 't',
      status: 'completed',
      actionItemsJson: JSON.stringify([
        { content: 'לשלוח הצעה', owner: 'ה-CTO', personId: 'p_omri' },
        { content: 'משהו לא ברור', owner: 'ה-CTO' },
      ]),
      createdAt: NOW,
      updatedAt: NOW,
    })

    expect(await proposeCommitmentsFromAnalysis(db, 'ma1', 'voice')).toBe(1)
    const rows = await db.select().from(commitments).where(and(eq(commitments.personId, 'p_omri'), eq(commitments.source, 'voice')))
    expect(rows.map((r) => [r.owner, r.content])).toEqual([['them', 'לשלוח הצעה']])
  })
})

describe('resolveCandidate', () => {
  const candidates = [
    { id: 'a', name: 'Omri Ben Simon', aliases: ['עומרי'] },
    { id: 'b', name: 'Omri Levi', aliases: [] },
    { id: 'c', name: 'דנה לוי', aliases: [] },
  ]

  it('matches by alias across scripts, and by first name when it is unique', () => {
    expect(resolveCandidate('עומרי', candidates)?.id).toBe('a')
    expect(resolveCandidate('דנה', candidates)?.id).toBe('c')
    expect(resolveCandidate('Omri Ben Simon', candidates)?.id).toBe('a')
  })

  it('returns null for an ambiguous or unknown name', () => {
    expect(resolveCandidate('Omri', candidates)).toBeNull()
    expect(resolveCandidate('יוסי', candidates)).toBeNull()
    expect(resolveCandidate('', candidates)).toBeNull()
  })
})
