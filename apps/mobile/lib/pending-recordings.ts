/**
 * Recordings kept on the device until the server confirms it has them
 * (docs/specs/voice-recording-never-lost.md). Each recording is moved out of the OS cache into
 * `documentDirectory/voice-pending/` the moment recording stops, and listed in a JSON index next
 * to it — a file rather than SecureStore, which caps values at ~2 KB.
 */

export type PendingState = 'review' | 'uploading' | 'pending'

export type PendingUpload = {
  id: string
  createdAt: string
  uri: string
  durationSeconds: number
  personIds: string[]
  personNames: string[]
  projectId?: string
  projectName?: string
  meetingId?: string
  meetingTitle?: string
  state: PendingState
  lastError?: string | null
}

/** The old single-recording SecureStore key (before this list existed). */
export const LEGACY_PENDING_VOICE_UPLOAD_KEY = 'helm_pending_voice_upload'
const DIR_NAME = 'voice-pending/'
const INDEX_NAME = 'index.json'

export function newPendingId(now = Date.now()): string {
  return `mob${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Turns the legacy single-object value into a list entry (or nothing if unreadable). */
export function migrateLegacyPending(raw: string | null, now = Date.now()): PendingUpload | null {
  if (!raw) return null
  try {
    const old = JSON.parse(raw) as Partial<PendingUpload>
    if (!old || typeof old.uri !== 'string') return null
    return {
      id: newPendingId(now),
      createdAt: new Date(now).toISOString(),
      uri: old.uri,
      durationSeconds: Number(old.durationSeconds) || 0,
      personIds: Array.isArray(old.personIds) ? old.personIds : [],
      personNames: Array.isArray(old.personNames) ? old.personNames : [],
      projectId: old.projectId,
      projectName: old.projectName,
      meetingId: old.meetingId,
      state: 'pending',
    }
  } catch {
    return null
  }
}

export function upsertPending(list: PendingUpload[], item: PendingUpload): PendingUpload[] {
  const i = list.findIndex((p) => p.id === item.id)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

export function patchPending(list: PendingUpload[], id: string, patch: Partial<PendingUpload>): PendingUpload[] {
  return list.map((p) => (p.id === id ? { ...p, ...patch } : p))
}

export function removePending(list: PendingUpload[], id: string): PendingUpload[] {
  return list.filter((p) => p.id !== id)
}

// ── Device IO ────────────────────────────────────────────────────────────────

async function fs() {
  return import('expo-file-system/legacy')
}

async function dir(): Promise<string | null> {
  const { documentDirectory, makeDirectoryAsync } = await fs()
  if (!documentDirectory) return null
  const path = documentDirectory + DIR_NAME
  await makeDirectoryAsync(path, { intermediates: true }).catch(() => undefined)
  return path
}

export async function loadPendingList(): Promise<PendingUpload[]> {
  const path = await dir()
  if (!path) return []
  const { readAsStringAsync, getInfoAsync } = await fs()
  try {
    const info = await getInfoAsync(path + INDEX_NAME)
    if (!info.exists) return []
    const list = JSON.parse(await readAsStringAsync(path + INDEX_NAME)) as PendingUpload[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Serialized so overlapping saves never interleave. */
let writeChain: Promise<void> = Promise.resolve()
export function savePendingList(list: PendingUpload[]): Promise<void> {
  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      const path = await dir()
      if (!path) return
      const { writeAsStringAsync, moveAsync } = await fs()
      const tmp = path + INDEX_NAME + '.tmp'
      await writeAsStringAsync(tmp, JSON.stringify(list))
      await moveAsync({ from: tmp, to: path + INDEX_NAME })
    })
  return writeChain
}

/**
 * Moves a just-stopped recording out of the cache (which the OS may purge) into durable app
 * storage. Falls back to the original uri if the move fails — the recording is never dropped.
 */
export async function persistRecordingFile(cacheUri: string, id: string): Promise<string> {
  const path = await dir()
  if (!path) return cacheUri
  const { moveAsync } = await fs()
  const ext = /\.([a-z0-9]{2,4})$/i.exec(cacheUri)?.[1] ?? 'm4a'
  const target = `${path}${id}.${ext}`
  try {
    await moveAsync({ from: cacheUri, to: target })
    return target
  } catch {
    return cacheUri
  }
}

export async function deleteRecordingFile(uri: string): Promise<void> {
  const { deleteAsync } = await fs()
  await deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}
