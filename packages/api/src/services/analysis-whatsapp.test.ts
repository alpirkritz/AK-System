import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetingAnalyses, meetings } from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import { formatAnalysisMessage } from './analysis-message'
import { notifyAnalysisOnWhatsApp } from './analysis-whatsapp'

vi.mock('./whatsapp-bridge-client', () => ({
  sendBridgeText: vi.fn(async () => ({ ok: true })),
}))

import { sendBridgeText } from './whatsapp-bridge-client'

const NOW = '2026-09-25T10:00:00.000Z'

describe('formatAnalysisMessage', () => {
  it('is the regular analysis text, including the score and the open question', () => {
    const text = formatAnalysisMessage({
      hatName: 'Executive Coaching',
      topic: 'תכנון אלגו',
      mood: 'ממוקד',
      subtext: 'יש לחץ על לוח הזמנים',
      keyInsight: 'צריך להחליט מי סוגר',
      score: 7,
      scoreRationale: 'ברור אבל בלי בעלים',
      kaizenKeep: 'סיכום בסוף',
      kaizenImprove: 'לחלק משימות',
      openQuestion: 'מי מחזיק את ההחלטה?',
      participants: [{ name: 'דנה', confirmed: true }],
      actionItems: [{ content: 'לשלוח סיכום', owner: 'אני' }],
    }, 'Algo 4.0', '2026-09-25')
    expect(text).toContain('✅ *ההקלטה נותחה!*')
    expect(text).toContain('*פגישה:* Algo 4.0')
    expect(text).toContain('7/10')
    expect(text).toContain('מי מחזיק את ההחלטה?')
    expect(text).toContain('• לשלוח סיכום (אני)')
  })
})

describe('notifyAnalysisOnWhatsApp', () => {
  beforeEach(async () => {
    await resetDb()
    vi.mocked(sendBridgeText).mockClear()
    vi.mocked(sendBridgeText).mockResolvedValue({ ok: true })
  })

  it('sends the regular analysis once', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'm1', title: 'Algo 4.0', date: '2026-09-25', time: '10:00', createdAt: NOW, updatedAt: NOW,
    })
    await db.insert(meetingAnalyses).values({
      id: 'a1',
      meetingId: 'm1',
      source: 'voice',
      topic: 'תכנון',
      mood: 'ממוקד',
      subtext: 'לחץ',
      keyInsight: 'להחליט',
      score: 7,
      scoreRationale: 'ברור',
      kaizenKeep: 'סיכום',
      kaizenImprove: 'בעלים',
      openQuestion: 'מי מחליט?',
      hatName: 'Coaching',
      participantsJson: JSON.stringify([{ name: 'דנה', confirmed: true }]),
      actionItemsJson: JSON.stringify([{ content: 'לשלוח סיכום' }]),
      status: 'completed',
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(await notifyAnalysisOnWhatsApp(db, 'a1')).toEqual({ sent: true })
    expect(await notifyAnalysisOnWhatsApp(db, 'a1')).toEqual({ sent: false })
    expect(sendBridgeText).toHaveBeenCalledTimes(1)
    const body = vi.mocked(sendBridgeText).mock.calls[0][0]
    expect(body).toContain('✅ *ההקלטה נותחה!*')
    expect(body).toContain('Algo 4.0')
    const [row] = await db.select({ notified: meetingAnalyses.whatsappNotifiedAt }).from(meetingAnalyses).where(eq(meetingAnalyses.id, 'a1'))
    expect(row?.notified).toBeTruthy()
  })
})
