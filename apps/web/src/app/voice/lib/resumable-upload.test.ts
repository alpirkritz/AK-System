import { describe, expect, it, vi } from 'vitest'
import { isRetryable, runResumableUpload, UploadHttpError, type ResumableTransport } from './resumable-upload'

function fakeServer(totalParts: number) {
  const received = new Set<number>()
  let completed: string | null = null
  const calls: string[] = []
  const failures = new Map<string, number>() // key → remaining failures
  const maybeFail = (key: string, err: Error) => {
    const left = failures.get(key) ?? 0
    if (left > 0) {
      failures.set(key, left - 1)
      throw err
    }
  }
  const transport: ResumableTransport = {
    async start() {
      calls.push('start')
      return { uploadId: 'vu_x' }
    },
    async status() {
      calls.push('status')
      return { receivedParts: [...received], completedRecordingId: completed }
    },
    async putPart(_id, index, onProgress) {
      calls.push(`part${index}`)
      onProgress(5)
      maybeFail(`part${index}`, new UploadHttpError('החיבור נקטע', 0))
      received.add(index)
    },
    async complete() {
      calls.push('complete')
      maybeFail('complete', new UploadHttpError('Bad gateway', 502))
      for (let i = 0; i < totalParts; i++) if (!received.has(i)) throw new UploadHttpError('חסרים מקטעים', 400)
      completed = 'vr_1'
      return { recordingId: completed }
    },
  }
  return { transport, received, calls, failures, setCompleted: (id: string) => (completed = id) }
}

const noSleep = () => Promise.resolve()

describe('runResumableUpload', () => {
  it('sends every part then completes, reporting progress up to 1', async () => {
    const server = fakeServer(3)
    const progress: number[] = []
    const res = await runResumableUpload({
      transport: server.transport, totalBytes: 25, partSize: 10, onProgress: (f) => progress.push(f), sleep: noSleep,
    })
    expect(res).toEqual({ recordingId: 'vr_1' })
    expect(server.calls).toEqual(['start', 'status', 'part0', 'part1', 'part2', 'complete'])
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true)
  })

  it('retries a dropped part and tells the UI it is reconnecting, then clears it', async () => {
    const server = fakeServer(3)
    server.failures.set('part1', 2)
    const retrying = vi.fn()
    const sleep = vi.fn(noSleep)
    await runResumableUpload({ transport: server.transport, totalBytes: 25, partSize: 10, onRetrying: retrying, sleep })
    expect(server.calls.filter((c) => c === 'part1')).toHaveLength(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(retrying).toHaveBeenNthCalledWith(1, expect.objectContaining({ attempt: 1 }))
    expect(retrying).toHaveBeenLastCalledWith(null)
  })

  it('skips parts the server already has (resume after reload)', async () => {
    const server = fakeServer(3)
    server.received.add(0)
    server.received.add(1)
    await runResumableUpload({ transport: server.transport, totalBytes: 25, partSize: 10, sleep: noSleep })
    expect(server.calls).toEqual(['start', 'status', 'part2', 'complete'])
  })

  it('returns the existing recording when the upload already completed (lost response)', async () => {
    const server = fakeServer(3)
    server.setCompleted('vr_done')
    const res = await runResumableUpload({ transport: server.transport, totalBytes: 25, partSize: 10, sleep: noSleep })
    expect(res.recordingId).toBe('vr_done')
    expect(server.calls).toEqual(['start', 'status'])
  })

  it('retries a 5xx on complete', async () => {
    const server = fakeServer(1)
    server.failures.set('complete', 1)
    const res = await runResumableUpload({ transport: server.transport, totalBytes: 5, partSize: 10, sleep: noSleep })
    expect(res.recordingId).toBe('vr_1')
  })

  it('gives up after the last retry, and never retries a validation error', async () => {
    const server = fakeServer(1)
    server.failures.set('part0', 99)
    await expect(
      runResumableUpload({ transport: server.transport, totalBytes: 5, partSize: 10, sleep: noSleep, delaysMs: [1, 1] }),
    ).rejects.toThrow('החיבור נקטע')
    expect(server.calls.filter((c) => c === 'part0')).toHaveLength(3)

    expect(isRetryable(new UploadHttpError('ההקלטה גדולה מדי', 400))).toBe(false)
    expect(isRetryable(new UploadHttpError('x', 503))).toBe(true)
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
  })
})
