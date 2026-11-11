/**
 * Resumable, part-by-part recording upload (docs/specs/voice-recording-never-lost.md).
 *
 * A long meeting used to be one 30–60 MB request; any network blip killed it and a retry started
 * from byte 0. Here the client sends small parts, each idempotent, asks which parts already
 * arrived before resuming, and finally asks the server to assemble them. Session state is plain
 * files under `<voiceStorageDir>/uploads/<uploadId>/` — short-lived, on the same volume as the audio.
 */
import * as fs from 'fs'
import * as path from 'path'
import type { getDb } from '@ak-system/database'
import {
  newVoiceRecordingId,
  registerStoredVoiceFile,
  voiceAudioPath,
  voiceMimeAndExt,
  voiceStorageDir,
  VoiceUploadError,
  VOICE_MAX_BYTES,
} from './voice'

type Db = ReturnType<typeof getDb>

/** Hard cap per part; clients send 4 MB. */
export const VOICE_PART_MAX_BYTES = 8 * 1024 * 1024
/** Untouched upload sessions older than this are removed by `cleanupStaleVoiceUploads`. */
export const VOICE_UPLOAD_STALE_MS = 7 * 24 * 60 * 60 * 1000

export interface VoiceUploadContext {
  durationSeconds: number
  consentConfirmed: boolean
  contextConfirmed?: boolean
  meetingId?: string | null
  projectId?: string | null
  personIds?: string[]
  source?: 'live' | 'imported'
}

export interface CreateVoiceUploadInput extends VoiceUploadContext {
  mimeType: string
  totalBytes: number
  partSize: number
  /** Stable id from the client's local copy; the same id always maps to the same upload. */
  clientSessionId: string
}

interface UploadMeta extends CreateVoiceUploadInput {
  uploadId: string
  partCount: number
  createdAt: string
  completedRecordingId?: string
}

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/

function uploadsRoot(): string {
  return path.join(voiceStorageDir(), 'uploads')
}

/** Upload id is derived from the client session id, so creating twice is naturally idempotent. */
function uploadIdFor(clientSessionId: string): string {
  return `vu_${clientSessionId}`
}

function uploadDir(uploadId: string): string {
  if (!ID_RE.test(uploadId)) throw new VoiceUploadError('מזהה העלאה לא תקין')
  return path.join(uploadsRoot(), uploadId)
}

function partPath(dir: string, index: number): string {
  return path.join(dir, `part-${String(index).padStart(5, '0')}`)
}

async function readMeta(uploadId: string): Promise<UploadMeta> {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(uploadDir(uploadId), 'meta.json'), 'utf8')) as UploadMeta
  } catch (err) {
    if (err instanceof VoiceUploadError) throw err
    throw new VoiceUploadError('ההעלאה לא נמצאה')
  }
}

async function writeMeta(meta: UploadMeta): Promise<void> {
  const file = path.join(uploadDir(meta.uploadId), 'meta.json')
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(meta))
  await fs.promises.rename(tmp, file)
}

export async function createVoiceUpload(input: CreateVoiceUploadInput): Promise<{ uploadId: string }> {
  if (!input.consentConfirmed) throw new VoiceUploadError('נדרש אישור שכל המשתתפים הסכימו להקלטה')
  if (!ID_RE.test(input.clientSessionId)) throw new VoiceUploadError('מזהה הקלטה לא תקין')
  if (!Number.isInteger(input.totalBytes) || input.totalBytes <= 0) throw new VoiceUploadError('קובץ ההקלטה ריק')
  if (input.totalBytes > VOICE_MAX_BYTES) throw new VoiceUploadError('ההקלטה גדולה מדי')
  if (!Number.isInteger(input.partSize) || input.partSize <= 0 || input.partSize > VOICE_PART_MAX_BYTES) {
    throw new VoiceUploadError('גודל מקטע לא תקין')
  }
  voiceMimeAndExt(input.mimeType)

  // Opportunistic housekeeping — abandoned sessions never pile up, no extra cron needed.
  void cleanupStaleVoiceUploads().catch(() => undefined)

  const uploadId = uploadIdFor(input.clientSessionId)
  const dir = uploadDir(uploadId)
  if (fs.existsSync(path.join(dir, 'meta.json'))) {
    const existing = await readMeta(uploadId)
    // Same local recording re-sent: keep the parts already received. If its size changed (a
    // recording recovered mid-way and re-sent fuller), start over.
    if (existing.totalBytes === input.totalBytes && existing.partSize === input.partSize) return { uploadId }
    if (existing.completedRecordingId) return { uploadId }
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
  await fs.promises.mkdir(dir, { recursive: true })
  await writeMeta({
    ...input,
    uploadId,
    partCount: Math.ceil(input.totalBytes / input.partSize),
    createdAt: new Date().toISOString(),
  })
  return { uploadId }
}

export async function getVoiceUploadStatus(
  uploadId: string,
): Promise<{ receivedParts: number[]; partCount: number; completedRecordingId: string | null }> {
  const meta = await readMeta(uploadId)
  return {
    receivedParts: await receivedParts(uploadDir(uploadId)),
    partCount: meta.partCount,
    completedRecordingId: meta.completedRecordingId ?? null,
  }
}

async function receivedParts(dir: string): Promise<number[]> {
  const names = await fs.promises.readdir(dir)
  return names
    .map((n) => /^part-(\d{5})$/.exec(n))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
}

/** Stores one part; re-sending the same index overwrites it. */
export async function writeVoiceUploadPart(uploadId: string, index: number, bytes: Buffer): Promise<{ size: number }> {
  const meta = await readMeta(uploadId)
  if (meta.completedRecordingId) return { size: bytes.length }
  if (!Number.isInteger(index) || index < 0 || index >= meta.partCount) throw new VoiceUploadError('מספר מקטע לא תקין')
  if (bytes.length === 0 || bytes.length > VOICE_PART_MAX_BYTES) throw new VoiceUploadError('גודל מקטע לא תקין')
  const isLast = index === meta.partCount - 1
  const expected = isLast ? meta.totalBytes - meta.partSize * (meta.partCount - 1) : meta.partSize
  if (bytes.length !== expected) throw new VoiceUploadError(`גודל מקטע ${index} לא תואם (${bytes.length}/${expected})`)
  const dir = uploadDir(uploadId)
  const file = partPath(dir, index)
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, bytes)
  await fs.promises.rename(tmp, file)
  return { size: bytes.length }
}

/**
 * Assembles the parts into the final recording and registers it. Calling it again for an upload
 * that already completed returns the same recording instead of creating a second one.
 * `context` lets the client send people/project/meeting choices made after the upload started.
 */
export function completeVoiceUpload(
  db: Db,
  uploadId: string,
  context: Partial<VoiceUploadContext> = {},
): Promise<{ recordingId: string; alreadyCompleted: boolean }> {
  // A client retrying `complete` while the first call is still assembling must not register twice.
  const running = completing.get(uploadId)
  if (running) return running.then((r) => ({ ...r, alreadyCompleted: true }))
  const p = assembleAndRegister(db, uploadId, context).finally(() => completing.delete(uploadId))
  completing.set(uploadId, p)
  return p
}

const completing = new Map<string, Promise<{ recordingId: string; alreadyCompleted: boolean }>>()

async function assembleAndRegister(
  db: Db,
  uploadId: string,
  context: Partial<VoiceUploadContext>,
): Promise<{ recordingId: string; alreadyCompleted: boolean }> {
  const meta = await readMeta(uploadId)
  if (meta.completedRecordingId) return { recordingId: meta.completedRecordingId, alreadyCompleted: true }

  const dir = uploadDir(uploadId)
  const have = new Set(await receivedParts(dir))
  const missing: number[] = []
  for (let i = 0; i < meta.partCount; i++) if (!have.has(i)) missing.push(i)
  if (missing.length > 0) throw new VoiceUploadError(`חסרים מקטעים: ${missing.slice(0, 10).join(', ')}`)

  const { mimeType, ext } = voiceMimeAndExt(meta.mimeType)
  const id = newVoiceRecordingId()
  await fs.promises.mkdir(voiceStorageDir(), { recursive: true })
  const audioPath = voiceAudioPath(id, ext)
  const out = fs.createWriteStream(audioPath)
  try {
    for (let i = 0; i < meta.partCount; i++) {
      await new Promise<void>((resolve, reject) => {
        const input = fs.createReadStream(partPath(dir, i))
        input.on('error', reject)
        input.on('end', resolve)
        input.pipe(out, { end: false })
      })
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (err) {
    out.destroy()
    await fs.promises.rm(audioPath, { force: true })
    throw err
  }
  const sizeBytes = (await fs.promises.stat(audioPath)).size
  if (sizeBytes !== meta.totalBytes) {
    await fs.promises.rm(audioPath, { force: true })
    throw new VoiceUploadError('הקובץ שהורכב לא שלם')
  }

  const merged = { ...meta, ...stripUndefined(context) }
  const { recordingId } = await registerStoredVoiceFile(db, {
    id,
    audioPath,
    mimeType,
    sizeBytes,
    durationSeconds: merged.durationSeconds,
    consentConfirmed: merged.consentConfirmed,
    contextConfirmed: merged.contextConfirmed,
    meetingId: merged.meetingId ?? null,
    projectId: merged.projectId ?? null,
    personIds: merged.personIds ?? [],
    source: merged.source ?? 'live',
  })

  // Keep meta (for idempotent re-complete) but drop the part files.
  await writeMeta({ ...meta, completedRecordingId: recordingId })
  for (const i of await receivedParts(dir)) await fs.promises.rm(partPath(dir, i), { force: true })
  return { recordingId, alreadyCompleted: false }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** Removes upload sessions not touched for `VOICE_UPLOAD_STALE_MS`. Returns how many were removed. */
export async function cleanupStaleVoiceUploads(now = Date.now()): Promise<number> {
  const root = uploadsRoot()
  if (!fs.existsSync(root)) return 0
  let removed = 0
  for (const name of await fs.promises.readdir(root)) {
    const dir = path.join(root, name)
    const stat = await fs.promises.stat(dir).catch(() => null)
    if (!stat?.isDirectory()) continue
    let newest = stat.mtimeMs
    for (const f of await fs.promises.readdir(dir)) {
      const s = await fs.promises.stat(path.join(dir, f)).catch(() => null)
      if (s && s.mtimeMs > newest) newest = s.mtimeMs
    }
    if (now - newest > VOICE_UPLOAD_STALE_MS) {
      await fs.promises.rm(dir, { recursive: true, force: true })
      removed++
    }
  }
  return removed
}
