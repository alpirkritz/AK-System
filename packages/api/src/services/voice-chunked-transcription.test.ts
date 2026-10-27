import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { generateContent, execFileMock, decodeToPcm16Mock, extractSpeechSegmentsMock, readFileSyncMock, mkdtempSyncMock, rmSyncMock } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  execFileMock: vi.fn(),
  decodeToPcm16Mock: vi.fn(),
  extractSpeechSegmentsMock: vi.fn(),
  readFileSyncMock: vi.fn(() => Buffer.alloc(10)),
  mkdtempSyncMock: vi.fn(() => '/tmp/ak-voice-chunk-test'),
  rmSyncMock: vi.fn(),
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent }
    }
  },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
  HarmBlockThreshold: { BLOCK_NONE: 'BLOCK_NONE' },
}))

// transcribeWithGemini's Files API branch isn't exercised here (chunks are small); stub it so the
// module loads without touching the real SDK.
vi.mock('@google/generative-ai/server', () => ({
  GoogleAIFileManager: class {},
  FileState: { PROCESSING: 'PROCESSING', ACTIVE: 'ACTIVE', FAILED: 'FAILED' },
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: readFileSyncMock, mkdtempSync: mkdtempSyncMock, rmSync: rmSyncMock }
})

vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>()
  return { ...actual, promisify: () => execFileMock }
})

vi.mock('./audio-features', () => ({
  decodeToPcm16: (...args: unknown[]) => decodeToPcm16Mock(...args),
  extractSpeechSegments: (...args: unknown[]) => extractSpeechSegmentsMock(...args),
  cosineSimilarity: (a: number[], b: number[]) => {
    // Simple dot-product stand-in: our fake embeddings are one-hot-ish, so this is enough to tell
    // "same speaker" from "different speaker" without needing the real math.
    let dot = 0
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
    return dot
  },
}))

import { probeAudioDurationSeconds, transcribeLongRecordingWithGemini, VOICE_CHUNK_THRESHOLD_SECONDS } from './voice'

function reply(text: string) {
  return { response: { text: () => text, candidates: [{ finishReason: 'STOP' }] } }
}

describe('transcribeLongRecordingWithGemini', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockReset()
    execFileMock.mockReset().mockResolvedValue({ stdout: '', stderr: '' })
    decodeToPcm16Mock.mockReset().mockResolvedValue(new Int16Array())
    extractSpeechSegmentsMock.mockReset()
    readFileSyncMock.mockReset().mockReturnValue(Buffer.alloc(10))
    mkdtempSyncMock.mockReset().mockReturnValue('/tmp/ak-voice-chunk-test')
    rmSyncMock.mockReset().mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('splits a recording over the threshold into chunks and offsets each chunk back onto the full timeline', async () => {
    extractSpeechSegmentsMock.mockReturnValue([])
    generateContent
      .mockResolvedValueOnce(reply('[{"speaker":"דובר 1","start":0,"end":2,"text":"שלום"}]'))
      .mockResolvedValueOnce(reply('[{"speaker":"דובר 1","start":0,"end":2,"text":"המשך"}]'))

    const chunkSeconds = 20 * 60
    const result = await transcribeLongRecordingWithGemini('/fake/rec.webm', 'audio/webm', chunkSeconds * 2)

    // One ffmpeg split call per chunk.
    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(execFileMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['-ss', '0', '-t', String(chunkSeconds)]),
    )
    expect(execFileMock.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['-ss', String(chunkSeconds), '-t', String(chunkSeconds)]),
    )

    // Second chunk's turn is offset by the first chunk's length.
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ startMs: 0, endMs: 2000 })
    expect(result.segments[1]).toMatchObject({ startMs: chunkSeconds * 1000, endMs: chunkSeconds * 1000 + 2000 })
    expect(result.text).toBe('דובר 1: שלום\nדובר 2: המשך')
  })

  it('recognises the same speaker across chunks by voiceprint, even though Gemini renumbers labels per chunk', async () => {
    // Chunk 1: two speakers. Chunk 2: Gemini calls them "דובר 1"/"דובר 2" again, but in swapped order.
    generateContent
      .mockResolvedValueOnce(
        reply(
          '[{"speaker":"דובר 1","start":0,"end":2,"text":"א1"},{"speaker":"דובר 2","start":3,"end":5,"text":"ב1"}]',
        ),
      )
      .mockResolvedValueOnce(
        reply(
          '[{"speaker":"דובר 1","start":0,"end":2,"text":"ב2"},{"speaker":"דובר 2","start":3,"end":5,"text":"א2"}]',
        ),
      )
    // Fake voiceprints: speaker A always embeds near [1,0], speaker B near [0,1].
    extractSpeechSegmentsMock
      .mockReturnValueOnce([
        { startMs: 0, endMs: 2000, embedding: [1, 0] },
        { startMs: 3000, endMs: 5000, embedding: [0, 1] },
      ])
      .mockReturnValueOnce([
        { startMs: 0, endMs: 2000, embedding: [0, 1] },
        { startMs: 3000, endMs: 5000, embedding: [1, 0] },
      ])

    const chunkSeconds = 20 * 60
    const result = await transcribeLongRecordingWithGemini('/fake/rec.webm', 'audio/webm', chunkSeconds * 2)

    const byText = new Map(result.segments.map((s) => [s.text, s.speakerLabel]))
    // Speaker A (embedding [1,0]) said א1 then א2 — should keep the same global label both times.
    expect(byText.get('א1')).toBe(byText.get('א2'))
    // Speaker B (embedding [0,1]) said ב1 then ב2 — same label, but different from speaker A's.
    expect(byText.get('ב1')).toBe(byText.get('ב2'))
    expect(byText.get('א1')).not.toBe(byText.get('ב1'))
  })

  it('keeps a chunk whose response is not parseable JSON as plain text instead of dropping it', async () => {
    extractSpeechSegmentsMock.mockReturnValue([])
    generateContent.mockResolvedValueOnce(reply('לא JSON בכלל, סתם טקסט'))

    const result = await transcribeLongRecordingWithGemini('/fake/rec.webm', 'audio/webm', 10 * 60)

    expect(result.text).toContain('לא JSON בכלל, סתם טקסט')
    expect(result.segments).toHaveLength(0)
  })

  it('leaves a clearly-marked gap for a chunk that still fails after retries, instead of failing the whole (possibly hour-plus) recording', async () => {
    extractSpeechSegmentsMock.mockReturnValue([])
    // transcribeWithGemini itself retries a failing chunk twice before giving up (see voice-large-file.test.ts) —
    // both attempts fail here to simulate a chunk nothing could recover.
    generateContent.mockRejectedValue(new Error('gemini down'))

    const result = await transcribeLongRecordingWithGemini('/fake/rec.webm', 'audio/webm', 10 * 60)

    expect(result.text).toContain('gemini down')
    expect(result.text).toContain('לא ניתן היה לתמלל')
    expect(rmSyncMock).toHaveBeenCalledWith('/tmp/ak-voice-chunk-test', { recursive: true, force: true })
  })

  it('still transcribes the chunks around a failed one', async () => {
    extractSpeechSegmentsMock.mockReturnValue([])
    generateContent
      .mockResolvedValueOnce(reply('[{"speaker":"דובר 1","start":0,"end":2,"text":"קטע ראשון"}]'))
      .mockRejectedValue(new Error('gemini down')) // both retry attempts for chunk 2 fail

    const chunkSeconds = 20 * 60
    const result = await transcribeLongRecordingWithGemini('/fake/rec.webm', 'audio/webm', chunkSeconds * 2)

    expect(result.text).toContain('קטע ראשון')
    expect(result.text).toContain('לא ניתן היה לתמלל')
  })
})

describe('probeAudioDurationSeconds', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('reads the container duration from ffprobe', async () => {
    execFileMock.mockResolvedValue({ stdout: '4379.521300\n', stderr: '' })
    await expect(probeAudioDurationSeconds('/fake/rec.m4a')).resolves.toBeCloseTo(4379.5213)
    expect(execFileMock.mock.calls[0][0]).toBe('ffprobe')
  })

  it('returns null when the file has no duration header', async () => {
    execFileMock.mockResolvedValue({ stdout: 'N/A\n', stderr: '' })
    await expect(probeAudioDurationSeconds('/fake/rec.webm')).resolves.toBeNull()
  })

  it('returns null when ffprobe is missing or fails', async () => {
    execFileMock.mockRejectedValue(new Error('spawn ffprobe ENOENT'))
    await expect(probeAudioDurationSeconds('/fake/rec.m4a')).resolves.toBeNull()
  })

  it('puts a 31-minute recording over the chunking threshold', () => {
    expect(1838).toBeGreaterThan(VOICE_CHUNK_THRESHOLD_SECONDS)
  })
})
