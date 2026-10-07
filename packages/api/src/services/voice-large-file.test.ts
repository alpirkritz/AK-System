import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateContent = vi.fn()
const uploadFile = vi.fn()
const getFile = vi.fn()
const deleteFile = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent }
    }
  },
}))

vi.mock('@google/generative-ai/server', () => ({
  GoogleAIFileManager: class {
    uploadFile(...args: unknown[]) {
      return uploadFile(...args)
    }
    getFile(...args: unknown[]) {
      return getFile(...args)
    }
    deleteFile(...args: unknown[]) {
      return deleteFile(...args)
    }
  },
  FileState: { PROCESSING: 'PROCESSING', ACTIVE: 'ACTIVE', FAILED: 'FAILED' },
}))

import { transcribeWithGemini } from './voice'

function reply(text: string) {
  return { response: { text: () => text } }
}

const INLINE_MAX = 19 * 1024 * 1024

describe('transcribeWithGemini', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockReset()
    uploadFile.mockReset()
    getFile.mockReset()
    deleteFile.mockReset()
    // The real deleteFile returns a promise, and the cleanup path chains .catch on it.
    deleteFile.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses inline data for a small recording, never touching the Files API', async () => {
    generateContent.mockResolvedValueOnce(reply('דובר 1: שלום'))
    const text = await transcribeWithGemini(Buffer.alloc(1024, 'a'), 'audio/webm')
    expect(text).toBe('דובר 1: שלום')
    expect(generateContent).toHaveBeenCalledTimes(1)
    const parts = generateContent.mock.calls[0][0] as unknown[]
    expect(parts[0]).toMatchObject({ inlineData: { mimeType: 'audio/webm' } })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('uploads via the Files API for a recording over the inline threshold, and always deletes the file', async () => {
    uploadFile.mockResolvedValueOnce({ file: { name: 'files/abc', uri: 'gemini://files/abc', mimeType: 'audio/webm', state: 'ACTIVE' } })
    generateContent.mockResolvedValueOnce(reply('דובר 1: שיחה ארוכה'))
    const big = Buffer.alloc(INLINE_MAX + 1024, 'b')

    const text = await transcribeWithGemini(big, 'audio/webm')

    expect(text).toBe('דובר 1: שיחה ארוכה')
    // Identity, not deep equality — structurally comparing a 19MB buffer exhausts the heap.
    expect(uploadFile.mock.calls[0][0]).toBe(big)
    expect(uploadFile.mock.calls[0][1]).toMatchObject({ mimeType: 'audio/webm' })
    expect(getFile).not.toHaveBeenCalled() // already ACTIVE on upload, no polling needed
    const parts = generateContent.mock.calls[0][0] as unknown[]
    expect(parts[0]).toMatchObject({ fileData: { fileUri: 'gemini://files/abc', mimeType: 'audio/webm' } })
    expect(deleteFile).toHaveBeenCalledWith('files/abc')
  })

  it('polls while PROCESSING until the file becomes ACTIVE', async () => {
    vi.useFakeTimers()
    uploadFile.mockResolvedValueOnce({ file: { name: 'files/p1', uri: 'gemini://files/p1', mimeType: 'audio/mp4', state: 'PROCESSING' } })
    getFile.mockResolvedValueOnce({ name: 'files/p1', uri: 'gemini://files/p1', mimeType: 'audio/mp4', state: 'ACTIVE' })
    generateContent.mockResolvedValueOnce(reply('תמלול אחרי עיבוד'))

    const promise = transcribeWithGemini(Buffer.alloc(INLINE_MAX + 1, 'c'), 'audio/mp4')
    await vi.advanceTimersByTimeAsync(2000)
    const text = await promise

    expect(text).toBe('תמלול אחרי עיבוד')
    expect(getFile).toHaveBeenCalledTimes(1)
    expect(deleteFile).toHaveBeenCalledWith('files/p1')
  })

  it('throws and still deletes the file when Gemini marks it FAILED', async () => {
    uploadFile.mockResolvedValueOnce({ file: { name: 'files/bad', uri: 'gemini://files/bad', mimeType: 'audio/webm', state: 'FAILED' } })

    await expect(transcribeWithGemini(Buffer.alloc(INLINE_MAX + 1, 'd'), 'audio/webm')).rejects.toThrow()
    expect(generateContent).not.toHaveBeenCalled()
    expect(deleteFile).toHaveBeenCalledWith('files/bad')
  })
})
