import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getSchedulablePreference, markNotificationSent, pushAssistantMessage } = vi.hoisted(() => ({
  getSchedulablePreference: vi.fn(),
  markNotificationSent: vi.fn(),
  pushAssistantMessage: vi.fn(),
}))

vi.mock('@ak-system/api', () => ({
  getSchedulablePreference,
  markNotificationSent,
  wasNotificationSentToday: (lastSentAt: string | null) =>
    !!lastSentAt && lastSentAt.slice(0, 10) === new Date().toISOString().slice(0, 10),
}))

vi.mock('./push-notifications', () => ({ pushAssistantMessage }))

import {
  selectFinanceAlerts,
  formatFinanceBriefLines,
  maybePushFinanceAlert,
  FINANCE_ALERT_TYPE_ID,
  type FinanceAlertInsight,
} from './finance-alerts'

function insight(over: Partial<FinanceAlertInsight> = {}): FinanceAlertInsight {
  return {
    kind: 'overspend',
    severity: 'warn',
    title: 'מזון — ₪2,000 מעל הרגיל',
    body: 'הוצאת ₪5,000 החודש מול ממוצע ₪3,000.',
    amount: 2000,
    ...over,
  }
}

beforeEach(() => {
  getSchedulablePreference.mockReset()
  markNotificationSent.mockReset()
  pushAssistantMessage.mockReset()
  getSchedulablePreference.mockResolvedValue({ enabled: true, scheduleTimes: [], lastSentAt: null })
  pushAssistantMessage.mockResolvedValue({ telegram: true, whatsapp: false, webPush: 1, fcmPush: 0 })
})

describe('selectFinanceAlerts', () => {
  it('keeps only warnings above the shekel threshold, worst first', () => {
    const selected = selectFinanceAlerts([
      insight({ amount: 1200, title: 'בינוני' }),
      insight({ amount: 300, title: 'קטן מדי' }),
      insight({ amount: 9000, title: 'הכי גדול' }),
      insight({ severity: 'info', amount: 9999, title: 'רק מידע' }),
      insight({ severity: 'opportunity', amount: 9999, title: 'הזדמנות' }),
    ])
    expect(selected.map((i) => i.title)).toEqual(['הכי גדול', 'בינוני'])
  })

  it('treats a negative amount by its magnitude', () => {
    expect(selectFinanceAlerts([insight({ amount: -5000 })])).toHaveLength(1)
  })

  it('drops warnings with no figure attached', () => {
    expect(selectFinanceAlerts([insight({ amount: null })])).toEqual([])
  })
})

describe('formatFinanceBriefLines', () => {
  it('returns at most three lines for the briefing', () => {
    const lines = formatFinanceBriefLines(
      Array.from({ length: 5 }, (_, i) => insight({ amount: 2000 + i, title: `שורה ${i}` }))
    )
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('• שורה 4')
  })

  it('returns nothing when there is nothing worth reporting', () => {
    expect(formatFinanceBriefLines([insight({ severity: 'info' })])).toEqual([])
  })
})

describe('maybePushFinanceAlert', () => {
  it('pushes the top finding with a deep link to the insights tab', async () => {
    const result = await maybePushFinanceAlert([insight()])
    expect(result).toEqual({ sent: true, reason: 'sent' })
    const [text, source, options] = pushAssistantMessage.mock.calls[0]
    expect(text).toContain('מזון')
    expect(source).toBe('cron')
    expect(options.url).toBe('/finance?tab=insights')
    expect(options.typeId).toBe(FINANCE_ALERT_TYPE_ID)
    expect(markNotificationSent).toHaveBeenCalledWith(FINANCE_ALERT_TYPE_ID)
  })

  it('stays quiet when nothing crosses the threshold', async () => {
    const result = await maybePushFinanceAlert([insight({ amount: 100 })])
    expect(result.reason).toBe('nothing-to-report')
    expect(pushAssistantMessage).not.toHaveBeenCalled()
  })

  it('sends at most one finance push per day', async () => {
    getSchedulablePreference.mockResolvedValue({
      enabled: true,
      scheduleTimes: [],
      lastSentAt: new Date().toISOString(),
    })
    const result = await maybePushFinanceAlert([insight()])
    expect(result.reason).toBe('already-sent-today')
    expect(pushAssistantMessage).not.toHaveBeenCalled()
  })

  it('respects the user turning the alert off', async () => {
    getSchedulablePreference.mockResolvedValue({ enabled: false, scheduleTimes: [], lastSentAt: null })
    const result = await maybePushFinanceAlert([insight()])
    expect(result.reason).toBe('disabled')
    expect(pushAssistantMessage).not.toHaveBeenCalled()
  })

  it('mentions the runners-up without turning the push into a report', async () => {
    await maybePushFinanceAlert([
      insight({ amount: 5000, title: 'ראשי' }),
      insight({ amount: 4000, title: 'משני' }),
      insight({ amount: 3000, title: 'שלישי' }),
      insight({ amount: 2000, title: 'רביעי' }),
    ])
    const [text] = pushAssistantMessage.mock.calls[0]
    expect(text).toContain('ראשי')
    expect(text).toContain('• משני')
    expect(text).not.toContain('רביעי')
  })
})
