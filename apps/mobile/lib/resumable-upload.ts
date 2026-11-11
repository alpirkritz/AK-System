/**
 * Part-by-part recording upload that survives connection drops
 * (docs/specs/voice-recording-never-lost.md). The retry/resume core mirrors
 * apps/web/src/app/voice/lib/resumable-upload.ts — the two apps share no client package, so keep
 * them in step. Its behavior is covered by the web copy's tests.
 */
import { API_URL, CLIENT_HEADER } from './api'


export const UPLOAD_PART_BYTES = 4 * 1024 * 1024
/** Waits between attempts of one step; its length + 1 is the attempt count. */
export const UPLOAD_RETRY_DELAYS_MS = [1000, 3000, 10_000, 30_000, 60_000]

export class UploadHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Network failures, timeouts and server-side errors are worth retrying; validation errors are not. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof UploadHttpError)) return true
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500
}

export interface ResumableTransport {
  start(): Promise<{ uploadId: string }>
  status(uploadId: string): Promise<{ receivedParts: number[]; completedRecordingId: string | null }>
  /** Sends part `index`; reports bytes of this part sent so far. */
  putPart(uploadId: string, index: number, onPartProgress: (loaded: number) => void): Promise<void>
  complete(uploadId: string): Promise<{ recordingId: string }>
}

export interface ResumableUploadOptions {
  transport: ResumableTransport
  totalBytes: number
  partSize?: number
  onProgress?: (fraction: number) => void
  /** Called before each retry wait; `null` once a step succeeds again. */
  onRetrying?: (info: { attempt: number; error: string } | null) => void
  delaysMs?: number[]
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runResumableUpload(opts: ResumableUploadOptions): Promise<{ recordingId: string }> {
  const { transport, totalBytes } = opts
  const partSize = opts.partSize ?? UPLOAD_PART_BYTES
  const delays = opts.delaysMs ?? UPLOAD_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? defaultSleep
  const partCount = Math.ceil(totalBytes / partSize)
  const sizeOf = (i: number) => (i === partCount - 1 ? totalBytes - partSize * (partCount - 1) : partSize)

  let retrying = false
  const step = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await fn()
        if (retrying) {
          retrying = false
          opts.onRetrying?.(null)
        }
        return result
      } catch (err) {
        if (!isRetryable(err) || attempt >= delays.length) throw err
        retrying = true
        opts.onRetrying?.({ attempt: attempt + 1, error: err instanceof Error ? err.message : String(err) })
        await sleep(delays[attempt])
      }
    }
  }

  const { uploadId } = await step(() => transport.start())
  const status = await step(() => transport.status(uploadId))
  if (status.completedRecordingId) {
    opts.onProgress?.(1)
    return { recordingId: status.completedRecordingId }
  }
  const have = new Set(status.receivedParts)
  let confirmed = [...have].reduce((sum, i) => sum + (i < partCount ? sizeOf(i) : 0), 0)
  opts.onProgress?.(confirmed / totalBytes)

  for (let i = 0; i < partCount; i++) {
    if (have.has(i)) continue
    await step(() =>
      transport.putPart(uploadId, i, (loaded) => opts.onProgress?.(Math.min(1, (confirmed + loaded) / totalBytes))),
    )
    confirmed += sizeOf(i)
    opts.onProgress?.(confirmed / totalBytes)
  }
  return step(() => transport.complete(uploadId))
}

// ── React Native transport ───────────────────────────────────────────────────

export interface MobileUploadInput {
  /** Stable local id of the recording — the same id always resumes the same server upload. */
  clientSessionId: string
  uri: string
  durationSeconds: number
  personIds: string[]
  meetingId?: string | null
  projectId?: string | null
  mimeType?: string
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-AK-Client': CLIENT_HEADER,
    'ngrok-skip-browser-warning': 'true',
    'Content-Type': 'application/json',
  }
}

async function jsonRequest<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new UploadHttpError('EXPO_PUBLIC_API_URL is not configured', 400)
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new UploadHttpError('אין חיבור לשרת', 0)
  }
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* non-JSON proxy page */
  }
  if (!res.ok) throw new UploadHttpError(String(data.error ?? `ההעלאה נכשלה (${res.status})`), res.status)
  return data as T
}

/**
 * Uploads a recorded file part by part. Parts are read as base64 byte ranges (React Native
 * can't send a slice of a file as a binary body) and sent as JSON.
 */
export async function uploadFileResumable(
  token: string,
  input: MobileUploadInput,
  handlers: Pick<ResumableUploadOptions, 'onProgress' | 'onRetrying'> = {},
): Promise<{ recordingId: string }> {
  const { getInfoAsync, readAsStringAsync, EncodingType } = await import('expo-file-system/legacy')
  const info = await getInfoAsync(input.uri)
  if (!info.exists || !('size' in info) || !info.size) throw new UploadHttpError('קובץ ההקלטה לא נמצא במכשיר', 400)
  const totalBytes = info.size
  const partSize = UPLOAD_PART_BYTES
  const base = '/api/voice/uploads'
  const context = {
    meetingId: input.meetingId ?? null,
    projectId: input.projectId ?? null,
    personIds: input.personIds,
    contextConfirmed: true,
    durationSeconds: Math.round(input.durationSeconds),
  }
  const transport: ResumableTransport = {
    start: () =>
      jsonRequest(token, 'POST', base, {
        ...context,
        clientSessionId: input.clientSessionId,
        mimeType: input.mimeType ?? 'audio/mp4',
        totalBytes,
        partSize,
        consentConfirmed: true,
        source: 'live',
      }),
    status: (id) => jsonRequest(token, 'GET', `${base}/${encodeURIComponent(id)}`),
    putPart: async (id, i, onPartProgress) => {
      const length = Math.min(partSize, totalBytes - i * partSize)
      const base64 = await readAsStringAsync(input.uri, { encoding: EncodingType.Base64, position: i * partSize, length })
      await jsonRequest(token, 'PUT', `${base}/${encodeURIComponent(id)}/parts/${i}`, { base64 })
      onPartProgress(length)
    },
    complete: (id) => jsonRequest(token, 'POST', `${base}/${encodeURIComponent(id)}/complete`, context),
  }
  return runResumableUpload({ transport, totalBytes, partSize, ...handlers })
}
