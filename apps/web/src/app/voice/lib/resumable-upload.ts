/**
 * Part-by-part recording upload that survives connection drops
 * (docs/specs/voice-recording-never-lost.md). The transport is injected so the retry/resume
 * logic is testable without a network. Mirrors apps/mobile/lib/resumable-upload.ts — the two apps
 * share no client package, so keep them in step.
 */

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

// ── Browser transport ────────────────────────────────────────────────────────

export interface UploadContext {
  clientSessionId: string
  mimeType: string
  durationSeconds: number
  meetingId: string | null
  projectId: string | null
  personIds: string[]
}

async function jsonRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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

function putBlob(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.timeout = 120_000
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let msg = `ההעלאה נכשלה (${xhr.status})`
      try {
        msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg
      } catch {
        /* ignore */
      }
      reject(new UploadHttpError(msg, xhr.status))
    }
    xhr.onerror = () => reject(new UploadHttpError('החיבור נקטע', 0))
    xhr.ontimeout = () => reject(new UploadHttpError('החיבור נקטע', 0))
    xhr.send(blob)
  })
}

export function browserTransport(blob: Blob, ctx: UploadContext, partSize = UPLOAD_PART_BYTES): ResumableTransport {
  const base = '/api/voice/uploads'
  return {
    start: () =>
      jsonRequest('POST', base, {
        clientSessionId: ctx.clientSessionId,
        mimeType: blob.type || ctx.mimeType,
        totalBytes: blob.size,
        partSize,
        durationSeconds: ctx.durationSeconds,
        consentConfirmed: true,
        contextConfirmed: true,
        meetingId: ctx.meetingId,
        projectId: ctx.projectId,
        personIds: ctx.personIds,
        source: 'live',
      }),
    status: (id) => jsonRequest('GET', `${base}/${encodeURIComponent(id)}`),
    putPart: (id, i, onProgress) =>
      putBlob(`${base}/${encodeURIComponent(id)}/parts/${i}`, blob.slice(i * partSize, (i + 1) * partSize), onProgress),
    // Review choices may have changed since `start` (a resumed upload), so send them again.
    complete: (id) =>
      jsonRequest('POST', `${base}/${encodeURIComponent(id)}/complete`, {
        meetingId: ctx.meetingId,
        projectId: ctx.projectId,
        personIds: ctx.personIds,
        contextConfirmed: true,
        durationSeconds: ctx.durationSeconds,
      }),
  }
}

export function uploadBlobResumable(
  blob: Blob,
  ctx: UploadContext,
  handlers: Pick<ResumableUploadOptions, 'onProgress' | 'onRetrying'> = {},
): Promise<{ recordingId: string }> {
  return runResumableUpload({ transport: browserTransport(blob, ctx), totalBytes: blob.size, ...handlers })
}
