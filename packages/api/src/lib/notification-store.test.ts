import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, notifications, eq } from '@ak-system/database'
import {
  MAX_NOTIFICATION_BODY,
  clampNotificationBody,
  createNotification,
} from './notification-store'

const AGENT_BRIEF = [
  '🤖 Meeting Prep Herald',
  '',
  '# Pre-meeting brief: Alpir - Tinko 1:1',
  '',
  '## Bottom line',
  '* לדון בהתקדמות אוטומציה של כרטיסי JIRA (דדליין דחוף).',
  '* להבין סטטוס שחרור גרסת Algo 2.64 עבור Doordash 1.4.4.',
  '* לשפר תקשורת פנימית ב-R&D לגבי Algo 4.0.',
  '',
  '## Meeting agenda',
  '1. סטטוס אוטומציה',
  '2. בלוקרים פתוחים',
  '3. תכנון השבוע הבא',
].join('\n')

describe('clampNotificationBody', () => {
  it('returns short bodies untouched', () => {
    expect(clampNotificationBody('שלום')).toBe('שלום')
  })

  it('preserves newlines instead of collapsing whitespace', () => {
    const clamped = clampNotificationBody(AGENT_BRIEF)
    expect(clamped).toBe(AGENT_BRIEF)
    expect(clamped.split('\n').length).toBeGreaterThan(10)
  })

  it('keeps text well past the old 240-character push excerpt limit', () => {
    const body = 'א'.repeat(5000)
    expect(clampNotificationBody(body)).toBe(body)
    expect(clampNotificationBody(body)).not.toContain('…')
  })

  it('clamps and marks bodies above the cap', () => {
    const body = 'א'.repeat(MAX_NOTIFICATION_BODY + 500)
    const clamped = clampNotificationBody(body)
    expect(clamped.length).toBe(MAX_NOTIFICATION_BODY)
    expect(clamped.endsWith('…')).toBe(true)
  })
})

describe('createNotification', () => {
  beforeEach(async () => {
    await getDb().delete(notifications)
  })

  async function readBody(id: string): Promise<string> {
    const rows = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1)
    return rows[0]?.body ?? ''
  }

  it('persists a long multi-line agent brief in full', async () => {
    const id = await createNotification({
      title: 'Meeting Prep Herald — pre_meeting_briefing',
      body: AGENT_BRIEF,
      url: '/chat',
      type: 'cron',
    })

    const stored = await readBody(id)
    expect(stored).toBe(AGENT_BRIEF)
    expect(stored).toContain('## Meeting agenda')
    expect(stored).toContain('3. תכנון השבוע הבא')
    expect(stored.endsWith('…')).toBe(false)
  })

  it('does not truncate at the OS push excerpt length', async () => {
    const body = `${'ב'.repeat(400)}\nסוף ההודעה`
    const id = await createNotification({
      title: 'ארוך',
      body,
      url: '/chat',
      type: 'agent',
    })

    const stored = await readBody(id)
    expect(stored.length).toBeGreaterThan(240)
    expect(stored).toContain('סוף ההודעה')
  })

  it('applies the storage cap as a guard against runaway output', async () => {
    const id = await createNotification({
      title: 'ענק',
      body: 'ג'.repeat(MAX_NOTIFICATION_BODY + 1000),
      url: '/chat',
      type: 'system',
    })

    const stored = await readBody(id)
    expect(stored.length).toBe(MAX_NOTIFICATION_BODY)
    expect(stored.endsWith('…')).toBe(true)
  })
})
