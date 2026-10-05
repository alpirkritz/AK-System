import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }))

vi.mock('./whatsapp-insights', () => ({
  getModel: () => ({ generateContent }),
}))

import { defaultClassify } from './whatsapp-dm'

const ORIGINAL_KEY = process.env.GEMINI_API_KEY

function modelReturns(json: unknown) {
  generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(json) } })
}

describe('defaultClassify', () => {
  beforeEach(() => {
    generateContent.mockReset()
  })
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = ORIGINAL_KEY
  })

  it('falls back to the regex heuristic when no API key is set', async () => {
    delete process.env.GEMINI_API_KEY
    const out = await defaultClassify([
      { id: '1', speakerLabel: 'אני', text: 'אשלח לך מחר את הקובץ', ts: Date.parse('2026-09-24T10:00:00Z') },
      { id: '2', speakerLabel: 'שמיר', text: 'אל תשכח להביא לה בשישי', ts: Date.parse('2026-09-24T10:00:00Z') },
    ])
    // The regex only catches the first (tracked verb "אשלח"); the second is exactly the phrasing it misses.
    expect(out).toEqual([{ messageId: '1', kind: 'promise', content: 'אשלח לך מחר את הקובץ', due: '2026-09-25' }])
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('uses the model when configured, catching phrasing the regex misses', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    modelReturns({
      items: [
        { messageId: '2', kind: 'request', content: 'להביא לה משהו בשישי', due: '2026-09-25' },
      ],
    })
    const out = await defaultClassify([
      { id: '1', speakerLabel: 'אני', text: 'סבבה, דיברנו', ts: Date.parse('2026-09-24T10:00:00Z') },
      { id: '2', speakerLabel: 'שמיר', text: 'אל תשכח להביא לה בשישי', ts: Date.parse('2026-09-24T10:00:00Z') },
    ])
    expect(out).toEqual([{ messageId: '2', kind: 'request', content: 'להביא לה משהו בשישי', due: '2026-09-25' }])
  })

  it('drops a model item referencing an unknown message id, or missing content', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    modelReturns({
      items: [
        { messageId: 'ghost', kind: 'promise', content: 'לא באמת קיים', due: null },
        { messageId: '1', kind: 'promise', content: '', due: null },
        { messageId: '1', kind: 'nonsense', content: 'סוג לא חוקי', due: null },
      ],
    })
    const out = await defaultClassify([{ id: '1', speakerLabel: 'אני', text: 'משהו', ts: Date.now() }])
    expect(out).toEqual([])
  })

  it('falls back to the heuristic when the model call throws', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockRejectedValueOnce(new Error('quota exceeded'))
    const out = await defaultClassify([{ id: '1', speakerLabel: 'אני', text: 'אטפל בזה', ts: Date.now() }])
    expect(out).toEqual([{ messageId: '1', kind: 'promise', content: 'אטפל בזה', due: null }])
  })

  it('falls back to the heuristic when the model response is not valid JSON', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockResolvedValueOnce({ response: { text: () => 'not json at all' } })
    const out = await defaultClassify([{ id: '1', speakerLabel: 'אני', text: 'אבדוק ואחזור', ts: Date.now() }])
    expect(out).toEqual([{ messageId: '1', kind: 'promise', content: 'אבדוק ואחזור', due: null }])
  })
})
