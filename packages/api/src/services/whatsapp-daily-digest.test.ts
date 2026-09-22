import { describe, expect, it } from 'vitest'
import {
  arrangeDailyDigest,
  renderDailyDigestMarkdown,
  renderDailyDigestPlain,
  shouldSkipScheduledGroupSummaries,
  type FollowedDigestGroup,
} from './whatsapp-daily-digest'
import type { DailyDigestModel } from './whatsapp-insights'

function group(partial: Partial<FollowedDigestGroup> & Pick<FollowedDigestGroup, 'jid' | 'name'>): FollowedDigestGroup {
  return {
    labelName: null,
    priority: 0,
    messageCount: 1,
    messages: [],
    ...partial,
  }
}

const dateLabel = 'יום שלישי, 22.9'

describe('arrangeDailyDigest', () => {
  it('puts actions first, sorts sections, and keeps a shared fact once', () => {
    const model: DailyDigestModel = {
      actions: [
        { text: 'לאשר הגעה', source: 'גן' },
        { text: 'לענות על המייל', source: 'עבודה' },
      ],
      groups: [
        { name: 'הורים', line: 'דיברו על הטיול', detail: 'להביא כובע' },
        { name: 'צוות', line: 'דיברו על הטיול', detail: 'יציאה ב-8:00' },
        { name: 'צוות עבודה', line: 'שאלו אם מגיעים', detail: '' },
        { name: 'שכונה', line: 'מישהו מחפש שמרטף', detail: '' },
      ],
      shared: [{ label: 'גן', summary: 'הטיול ביום חמישי אושר.' }],
    }
    const arranged = arrangeDailyDigest({
      dateLabel,
      model,
      groups: [
        group({ jid: '1', name: 'הורים', labelName: 'גן', priority: 0, messageCount: 4 }),
        group({ jid: '2', name: 'צוות', labelName: 'גן', priority: 0, messageCount: 3 }),
        group({ jid: '3', name: 'צוות עבודה', labelName: 'עבודה', priority: 2, messageCount: 2 }),
        group({ jid: '4', name: 'שכונה', labelName: null, priority: 1, messageCount: 2 }),
        group({ jid: '5', name: 'שקטה', labelName: 'גן', priority: 0, messageCount: 0 }),
      ],
    })

    expect(arranged.actions.map((a) => a.source)).toEqual(['עבודה', 'גן'])
    expect(arranged.sections.map((s) => s.title)).toEqual(['עבודה', 'גן', 'אחר'])
    expect(arranged.quiet).toEqual(['שקטה'])
    expect(arranged.sections.find((s) => s.title === 'גן')?.summary).toBe('הטיול ביום חמישי אושר.')
    expect(arranged.sections.find((s) => s.title === 'גן')?.points.map((p) => p.text)).toEqual([
      'להביא כובע',
      'יציאה ב-8:00',
    ])

    const plain = renderDailyDigestPlain(arranged)
    expect(plain.indexOf('צריך אותך')).toBeGreaterThan(plain.indexOf('מה היה היום'))
    expect(plain.indexOf('עבודה')).toBeGreaterThan(plain.indexOf('צריך אותך'))
    expect(plain.indexOf('גן')).toBeGreaterThan(plain.indexOf('עבודה'))
    expect(plain.indexOf('שקט היום: שקטה')).toBeGreaterThan(plain.indexOf('אחר'))
    expect(plain.split('הטיול ביום חמישי אושר.').length - 1).toBe(1)
    expect(plain).not.toContain('צריך אותך\n\nצריך אותך')

    const markdown = renderDailyDigestMarkdown(arranged)
    expect(markdown.startsWith('# מה היה היום — יום שלישי, 22.9')).toBe(true)
    expect(markdown.indexOf('## צריך אותך')).toBeGreaterThan(0)
    expect(markdown.indexOf('## עבודה')).toBeGreaterThan(markdown.indexOf('## צריך אותך'))
    expect(markdown.indexOf('## גן')).toBeGreaterThan(markdown.indexOf('## עבודה'))
    expect(markdown.indexOf('- לענות על המייל — עבודה')).toBeGreaterThan(0)
    expect(markdown.indexOf('שקט היום: שקטה')).toBeGreaterThan(markdown.indexOf('## אחר'))
  })

  it('omits the action heading when there is nothing to do', () => {
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: {
        actions: [],
        groups: [{ name: 'הורים', line: 'תזכורת לחופש.', detail: '' }],
        shared: [],
      },
      groups: [group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 2 })],
    })
    const plain = renderDailyDigestPlain(arranged)
    expect(plain).not.toContain('צריך אותך')
    expect(plain).toContain('גן')
    expect(plain).toContain('תזכורת לחופש.')
  })

  it('says nothing happened and hides the quiet list when every followed group is empty', () => {
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: null,
      groups: [
        group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 0 }),
        group({ jid: '2', name: 'צוות', messageCount: 0 }),
      ],
    })
    const plain = renderDailyDigestPlain(arranged)
    expect(plain).toBe('מה היה היום — יום שלישי, 22.9\n\nהיום לא קרה כלום.')
    expect(plain).not.toContain('צריך אותך')
    expect(plain).not.toContain('הורים')
  })

  it('drops an action whose source is not a followed group', () => {
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: {
        actions: [{ text: 'להביא כובע', source: 'קבוצה שלא קיימת' }],
        groups: [{ name: 'הורים', line: 'שקט יחסית.', detail: '' }],
        shared: [],
      },
      groups: [group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 1 })],
    })
    expect(arranged.actions).toEqual([])
    expect(renderDailyDigestPlain(arranged)).not.toContain('צריך אותך')
  })
})

describe('shouldSkipScheduledGroupSummaries', () => {
  it('skips later the same local day after the digest was sent', () => {
    const sent = new Date().toISOString()
    expect(
      shouldSkipScheduledGroupSummaries({
        digestEnabled: true,
        lastSentAt: sent,
        timeZone: 'Asia/Jerusalem',
      }),
    ).toBe(true)
  })

  it('keeps per-group summaries when the digest is off or has not been sent today', () => {
    expect(
      shouldSkipScheduledGroupSummaries({
        digestEnabled: false,
        lastSentAt: new Date().toISOString(),
        timeZone: 'Asia/Jerusalem',
      }),
    ).toBe(false)
    expect(
      shouldSkipScheduledGroupSummaries({
        digestEnabled: true,
        lastSentAt: '2020-01-01T10:00:00.000Z',
        timeZone: 'Asia/Jerusalem',
      }),
    ).toBe(false)
  })
})
