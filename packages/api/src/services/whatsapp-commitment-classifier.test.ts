import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassificationUnavailable, defaultClassify } from './whatsapp-dm'

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }))

vi.mock('./whatsapp-insights', () => ({
  getModel: () => ({ generateContent }),
}))

const ORIGINAL_KEY = process.env.GEMINI_API_KEY

function modelReturns(json: unknown) {
  generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(json) } })
}

const line = (id: string, speakerLabel: string, text: string, citable = true) => ({
  id,
  speakerLabel,
  text,
  ts: Date.parse('2026-09-24T10:00:00Z'),
  citable,
})

describe('defaultClassify', () => {
  beforeEach(() => {
    generateContent.mockReset()
  })
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = ORIGINAL_KEY
  })

  it('proposes nothing when no API key is set', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(defaultClassify([line('1', 'אני', 'אשלח לך מחר את הקובץ')])).rejects.toBeInstanceOf(ClassificationUnavailable)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('keeps at most 3 standing commitments and drops a prior-context id', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    modelReturns({
      items: [
        { messageId: 'old', owner: 'me', content: 'מההקשר', because: 'ישן', due: null },
        { messageId: '1', owner: 'them', content: 'לשלוח חוזה', because: 'הבטיח לשלוח מחר', due: '2026-09-25' },
        { messageId: '1', owner: 'nope', content: 'בעלים לא חוקי', because: 'לא', due: null },
        { messageId: '1', owner: 'me', content: 'תאריך שבור', because: 'לא תאריך', due: 'מחר' },
        { messageId: '2', owner: 'me', content: 'להכין הצעה', because: 'לקח על עצמו', due: null },
        { messageId: '3', owner: 'them', content: 'לבדוק מחיר', because: 'נשאר פתוח', due: null },
        { messageId: '4', owner: 'me', content: 'רביעי שנזרק', because: 'מעבר לתקרה', due: null },
      ],
    })
    const out = await defaultClassify([
      line('old', 'דנה', 'תשלח חוזה', false),
      line('1', 'דנה', 'אשלח לך את החוזה מחר'),
      line('2', 'אני', 'אכין הצעה'),
      line('3', 'דנה', 'אבדוק מחיר'),
      line('4', 'אני', 'עוד משהו'),
    ])
    expect(out.map((item) => item.messageId)).toEqual(['1', '2', '3'])
    expect(out[0]).toMatchObject({ owner: 'them', content: 'לשלוח חוזה', due: '2026-09-25', because: 'הבטיח לשלוח מחר' })
    const prompt = String(generateContent.mock.calls[0][0])
    expect(prompt).toContain('CONTEXT')
    expect(prompt).toContain('[old]')
  })

  it('proposes nothing when the model call throws', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockRejectedValueOnce(new Error('quota exceeded'))
    await expect(defaultClassify([line('1', 'אני', 'אטפל בזה')])).rejects.toBeInstanceOf(ClassificationUnavailable)
  })

  it('proposes nothing when the model response is not valid JSON', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockResolvedValueOnce({ response: { text: () => 'not json at all' } })
    await expect(defaultClassify([line('1', 'אני', 'אבדוק ואחזור')])).rejects.toBeInstanceOf(ClassificationUnavailable)
  })
})
