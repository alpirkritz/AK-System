import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateContent = vi.fn()
const mockSaveChatMessage = vi.fn()
const mockGetDb = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      generateContent: mockGenerateContent,
    }),
  })),
}))

vi.mock('./conversation-engine', () => ({
  saveChatMessage: (...args: unknown[]) => mockSaveChatMessage(...args),
}))

vi.mock('./gemini-config', () => ({
  getGeminiModelOptions: () => ({}),
}))

vi.mock('./web-push', () => ({ sendBrowserPush: vi.fn() }))
vi.mock('./mobile-push', () => ({ sendMobilePush: vi.fn() }))
vi.mock('./notification-store', () => ({ createNotification: vi.fn() }))
vi.mock('./abc-agents', () => ({
  formatAgentList: vi.fn(),
  getAgentDisplayName: vi.fn(),
  HUGO_AGENT_ID: '01_Hugo_orchestrator',
}))
vi.mock('./agent-runner', () => ({ runAgentForUser: vi.fn() }))
vi.mock('./agent-chat-store', () => ({
  getAgentHistory: vi.fn().mockResolvedValue([]),
  saveAgentMessage: vi.fn(),
}))

vi.mock('@ak-system/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ak-system/database')>()
  return {
    ...actual,
    getDb: () => mockGetDb(),
  }
})

import { resolveWhatsAppGroupDisplayName, summarizeGroupMessages } from './whatsapp-bot'
import type { BufferedGroupMessage } from './whatsapp-bot'

const ORIGINAL_ENV = { ...process.env }

const sampleMessages: BufferedGroupMessage[] = [
  { senderName: 'דני', text: 'מישהו יודע מתי הפגישה?', timestamp: Date.now() },
  { senderName: 'מיכל', text: 'ביום רביעי ב-10', timestamp: Date.now() },
]

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  mockGenerateContent.mockReset()
  mockSaveChatMessage.mockReset()
  mockGetDb.mockReset()
  mockGenerateContent.mockResolvedValue({
    response: {
      text: () =>
        'בעיקר דיברו על מועד הפגישה הבאה — דני שאל מתי, מיכל ענתה שזה ברביעי ב-10. שיח רגוע ופרקטי, אין משהו דחוף שלא נסגר.',
    },
  })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('summarizeGroupMessages', () => {
  it('uses group name in header, not JID', async () => {
    const jid = '120363123456789012@g.us'
    const result = await summarizeGroupMessages('הורים כיתה ג׳', jid, sampleMessages)

    expect(result).toMatch(/^📋 סיכום קבוצה — הורים כיתה ג׳/)
    expect(result).not.toContain('120363123456789012')
    expect(result).toContain('בעיקר דיברו על מועד הפגישה')
    expect(result).not.toMatch(/נושא השיחה:|הלך הרוח:|^•/m)
    expect(mockSaveChatMessage).toHaveBeenCalledWith('assistant', result, 'whatsapp')
  })

  it('asks Gemini for friend-style narrative, not structured labels', async () => {
    await summarizeGroupMessages('צוות פרויקט', 'jid@g.us', sampleMessages)

    const prompt = mockGenerateContent.mock.calls[0]?.[0] as string
    expect(prompt).toContain('"צוות פרויקט"')
    expect(prompt).toContain('over coffee')
    expect(prompt).not.toContain('נושא השיחה:')
    expect(prompt).not.toContain('jid@g.us')
  })

  it('renders second-precision bridge timestamps as Israel local time', async () => {
    // 2026-07-09T11:30:00Z = 14:30 in Israel (UTC+3), delivered in seconds.
    await summarizeGroupMessages('צוות', 'jid@g.us', [
      { senderName: 'דני', text: 'היי', timestamp: Date.parse('2026-07-09T11:30:00.000Z') / 1000 },
    ])

    const prompt = mockGenerateContent.mock.calls[0]?.[0] as string
    expect(prompt).toContain('[09.07, 14:30] דני: היי')
    expect(prompt).not.toContain('1970')
  })
})

describe('resolveWhatsAppGroupDisplayName', () => {
  it('prefers explicit groupName from bridge', async () => {
    const name = await resolveWhatsAppGroupDisplayName('120363@g.us', 'שם מהברידג׳')
    expect(name).toBe('שם מהברידג׳')
  })

  it('falls back to JID fragment when no name provided and DB empty', async () => {
    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })
    mockGetDb.mockReturnValue({ select: selectMock })

    const name = await resolveWhatsAppGroupDisplayName('120363123456@g.us')
    expect(name).toBe('120363123456')
  })

  it('falls back to DB name when bridge omits groupName', async () => {
    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ name: 'הורים כיתה ג׳' }]),
        }),
      }),
    })
    mockGetDb.mockReturnValue({ select: selectMock })

    const name = await resolveWhatsAppGroupDisplayName('120363@g.us')
    expect(name).toBe('הורים כיתה ג׳')
  })
})
