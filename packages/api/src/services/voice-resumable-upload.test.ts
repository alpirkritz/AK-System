import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { people, voiceRecordingPeople, voiceRecordings } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../test-utils'
import {
  cleanupStaleVoiceUploads,
  completeVoiceUpload,
  createVoiceUpload,
  getVoiceUploadStatus,
  writeVoiceUploadPart,
  VOICE_UPLOAD_STALE_MS,
} from './voice-resumable-upload'

let voiceDir: string
beforeAll(() => {
  voiceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-voice-resumable-'))
  process.env.VOICE_STORAGE_DIR = voiceDir
})
afterAll(() => {
  delete process.env.VOICE_STORAGE_DIR
  fs.rmSync(voiceDir, { recursive: true, force: true })
})

const PART = 10
/** 25 bytes → parts of 10, 10, 5 */
const AUDIO = Buffer.from('abcdefghijklmnopqrstuvwxy')
const partOf = (i: number) => AUDIO.subarray(i * PART, (i + 1) * PART)

function baseInput(clientSessionId: string) {
  return {
    clientSessionId,
    mimeType: 'audio/webm;codecs=opus',
    totalBytes: AUDIO.length,
    partSize: PART,
    durationSeconds: 3600,
    consentConfirmed: true,
    contextConfirmed: true,
    personIds: [] as string[],
  }
}

describe('resumable voice upload', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('assembles parts sent out of order and re-sent into one recording', async () => {
    const { uploadId } = await createVoiceUpload(baseInput('s1'))
    await writeVoiceUploadPart(uploadId, 2, partOf(2))
    await writeVoiceUploadPart(uploadId, 0, Buffer.from('XXXXXXXXXX'))
    await writeVoiceUploadPart(uploadId, 0, partOf(0)) // re-send overwrites
    await writeVoiceUploadPart(uploadId, 1, partOf(1))
    expect((await getVoiceUploadStatus(uploadId)).receivedParts).toEqual([0, 1, 2])

    const { recordingId } = await completeVoiceUpload(getTestDb(), uploadId)
    const [row] = await getTestDb().select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId))
    expect(row.status).toBe('uploaded')
    expect(row.mimeType).toBe('audio/webm')
    expect(row.duration).toBe(3600)
    expect(fs.readFileSync(row.audioPath)).toEqual(AUDIO)
  })

  it('refuses to complete while parts are missing, and resumes from the parts it has', async () => {
    const { uploadId } = await createVoiceUpload(baseInput('s2'))
    await writeVoiceUploadPart(uploadId, 0, partOf(0))
    await expect(completeVoiceUpload(getTestDb(), uploadId)).rejects.toThrow(/חסרים מקטעים: 1, 2/)

    // "connection dropped" — client asks again with the same session id and gets the same upload
    const again = await createVoiceUpload(baseInput('s2'))
    expect(again.uploadId).toBe(uploadId)
    expect((await getVoiceUploadStatus(uploadId)).receivedParts).toEqual([0])
    await writeVoiceUploadPart(uploadId, 1, partOf(1))
    await writeVoiceUploadPart(uploadId, 2, partOf(2))
    await expect(completeVoiceUpload(getTestDb(), uploadId)).resolves.toMatchObject({ alreadyCompleted: false })
  })

  it('completing twice — sequentially or concurrently — yields one recording', async () => {
    const { uploadId } = await createVoiceUpload(baseInput('s3'))
    for (let i = 0; i < 3; i++) await writeVoiceUploadPart(uploadId, i, partOf(i))
    const [a, b] = await Promise.all([
      completeVoiceUpload(getTestDb(), uploadId),
      completeVoiceUpload(getTestDb(), uploadId),
    ])
    const c = await completeVoiceUpload(getTestDb(), uploadId)
    expect(b.recordingId).toBe(a.recordingId)
    expect(c).toEqual({ recordingId: a.recordingId, alreadyCompleted: true })
    expect(await getTestDb().select().from(voiceRecordings)).toHaveLength(1)
    expect((await getVoiceUploadStatus(uploadId)).completedRecordingId).toBe(a.recordingId)
  })

  it('applies people chosen at review time, passed on complete', async () => {
    const db = getTestDb()
    const now = new Date().toISOString()
    await db.insert(people).values({ id: 'p_dana', name: 'דנה', createdAt: now, updatedAt: now } as never)
    const { uploadId } = await createVoiceUpload(baseInput('s4'))
    for (let i = 0; i < 3; i++) await writeVoiceUploadPart(uploadId, i, partOf(i))
    const { recordingId } = await completeVoiceUpload(db, uploadId, { personIds: ['p_dana'], contextConfirmed: true })
    const linked = await db.select().from(voiceRecordingPeople).where(eq(voiceRecordingPeople.recordingId, recordingId))
    expect(linked.map((l) => l.personId)).toEqual(['p_dana'])
  })

  it('rejects a part of the wrong size, an out-of-range index, and missing consent', async () => {
    const { uploadId } = await createVoiceUpload(baseInput('s5'))
    await expect(writeVoiceUploadPart(uploadId, 0, Buffer.from('short'))).rejects.toThrow(/לא תואם/)
    await expect(writeVoiceUploadPart(uploadId, 3, partOf(0))).rejects.toThrow(/מספר מקטע/)
    await expect(createVoiceUpload({ ...baseInput('s6'), consentConfirmed: false })).rejects.toThrow(/אישור/)
    await expect(createVoiceUpload({ ...baseInput('../x') })).rejects.toThrow(/מזהה/)
    await expect(getVoiceUploadStatus('../../etc')).rejects.toThrow(/מזהה/)
  })

  it('starts over when the same local recording comes back with a different size', async () => {
    const { uploadId } = await createVoiceUpload(baseInput('s7'))
    await writeVoiceUploadPart(uploadId, 0, partOf(0))
    await createVoiceUpload({ ...baseInput('s7'), totalBytes: 30 })
    expect((await getVoiceUploadStatus(uploadId)).receivedParts).toEqual([])
  })

  it('removes upload sessions untouched for a week', async () => {
    await createVoiceUpload(baseInput('s8'))
    expect(await cleanupStaleVoiceUploads(Date.now())).toBe(0)
    expect(await cleanupStaleVoiceUploads(Date.now() + VOICE_UPLOAD_STALE_MS + 60_000)).toBeGreaterThanOrEqual(1)
    await expect(getVoiceUploadStatus('vu_s8')).rejects.toThrow(/לא נמצאה/)
  })
})
