'use client'

/**
 * Durable on-device copy of a browser recording (docs/specs/voice-recording-never-lost.md).
 *
 * Every MediaRecorder chunk is appended to IndexedDB as it arrives, so a reload, a closed tab or a
 * crashed browser never costs more than the last second of audio. The copy is removed only after
 * the server confirms it stored the recording, or when the user explicitly deletes it.
 */

export type LocalRecordingState = 'recording' | 'review' | 'pending'

export interface LocalRecording {
  id: string
  startedAt: string
  mimeType: string
  /** Seconds of audio, kept current while recording so an interrupted session still has a length. */
  durationSeconds: number
  state: LocalRecordingState
  meetingId: string | null
  meetingTitle: string | null
  personIds: string[]
  personNames: string[]
  projectId: string
  /** Chunks stored so far (also the next chunk's sequence number). */
  chunkCount: number
  lastError?: string | null
}

const DB_NAME = 'ak-voice'
const DB_VERSION = 1
const SESSIONS = 'sessions'
const CHUNKS = 'chunks'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'id' })
      // key: [sessionId, seq]
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
  })
}

export function newLocalRecordingId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `web${rand}`.slice(0, 40)
}

export async function createLocalRecording(rec: LocalRecording): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(SESSIONS, 'readwrite')
  tx.objectStore(SESSIONS).put(rec)
  await done(tx)
}

/** Appends one chunk and bumps the session's chunk count/duration in the same transaction. */
export async function appendLocalChunk(id: string, seq: number, chunk: Blob, durationSeconds: number): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([SESSIONS, CHUNKS], 'readwrite')
  tx.objectStore(CHUNKS).put(chunk, [id, seq])
  const sessions = tx.objectStore(SESSIONS)
  const get = sessions.get(id)
  get.onsuccess = () => {
    const rec = get.result as LocalRecording | undefined
    if (rec) sessions.put({ ...rec, chunkCount: Math.max(rec.chunkCount, seq + 1), durationSeconds })
  }
  await done(tx)
}

export async function updateLocalRecording(id: string, patch: Partial<Omit<LocalRecording, 'id'>>): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(SESSIONS, 'readwrite')
  const store = tx.objectStore(SESSIONS)
  const get = store.get(id)
  get.onsuccess = () => {
    const rec = get.result as LocalRecording | undefined
    if (rec) store.put({ ...rec, ...patch })
  }
  await done(tx)
}

export async function listLocalRecordings(): Promise<LocalRecording[]> {
  const db = await openDb()
  const all = (await request(db.transaction(SESSIONS).objectStore(SESSIONS).getAll())) as LocalRecording[]
  return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/** Rebuilds the recorded audio from its stored chunks, in order. */
export async function loadLocalRecordingBlob(id: string): Promise<Blob | null> {
  const db = await openDb()
  const tx = db.transaction([SESSIONS, CHUNKS])
  const rec = (await request(tx.objectStore(SESSIONS).get(id))) as LocalRecording | undefined
  if (!rec) return null
  const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])
  const chunks = (await request(tx.objectStore(CHUNKS).getAll(range))) as Blob[]
  if (chunks.length === 0) return null
  return new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
}

export async function deleteLocalRecording(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([SESSIONS, CHUNKS], 'readwrite')
  tx.objectStore(SESSIONS).delete(id)
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
  await done(tx)
}
