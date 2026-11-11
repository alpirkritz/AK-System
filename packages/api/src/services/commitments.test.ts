import { describe, expect, it } from 'vitest'
import { buildCommitmentNotification, COMMITMENT_FRESH_HOURS, freshCommitments } from './commitments'

describe('buildCommitmentNotification', () => {
  it('names the chat and shows the content for a single commitment', () => {
    expect(buildCommitmentNotification([{ label: 'חרוזים', content: 'לקנות בשר' }])).toEqual({
      title: 'התחייבות חדשה מחרוזים',
      body: 'לקנות בשר\n\nעבור עליה ואשר אם נכנס למשימות.',
    })
  })

  it('lists up to 5 chat: content lines for several commitments, with a tail count', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ label: `קבוצה ${i + 1}`, content: `משימה ${i + 1}` }))
    const result = buildCommitmentNotification(items)
    expect(result.title).toBe('7 התחייבויות חדשות מהוואטסאפ')
    expect(result.body).toBe(
      [
        'קבוצה 1: משימה 1',
        'קבוצה 2: משימה 2',
        'קבוצה 3: משימה 3',
        'קבוצה 4: משימה 4',
        'קבוצה 5: משימה 5',
        'ועוד 2 נוספות.',
        'עבור עליהן ואשר מה נכנס למשימות.',
      ].join('\n'),
    )
  })

  it('appends the reason and labels an unknown sender without changing the title chat name', () => {
    expect(buildCommitmentNotification([{
      label: 'חרוזים',
      content: 'לקנות בשר',
      because: 'ביקשו בשר לשישי',
      unknownSender: true,
    }])).toEqual({
      title: 'התחייבות חדשה מחרוזים',
      body: 'מספר לא מוכר: לקנות בשר — ביקשו בשר לשישי\n\nעבור עליה ואשר אם נכנס למשימות.',
    })
  })

  it('lists every line with no tail count when there are 5 or fewer', () => {
    const items = [
      { label: 'דנה', content: 'לשלוח הצעה' },
      { label: 'חרוזים', content: 'לקנות בשר' },
    ]
    const result = buildCommitmentNotification(items)
    expect(result.title).toBe('2 התחייבויות חדשות מהוואטסאפ')
    expect(result.body).toBe('דנה: לשלוח הצעה\nחרוזים: לקנות בשר\nעבור עליהן ואשר מה נכנס למשימות.')
  })
})

describe('freshCommitments', () => {
  const now = Date.UTC(2026, 9, 5, 20, 0, 0)
  const hoursAgo = (h: number) => now - h * 3_600_000

  it('keeps a message from the last few hours', () => {
    const items = [{ label: 'דנה', content: 'לשלוח הצעה', sourceTs: hoursAgo(1) }]
    expect(freshCommitments(items, now)).toEqual(items)
  })

  it('drops a backfilled message from earlier in the day', () => {
    const items = [{ label: 'דנה', content: 'לשלוח הצעה', sourceTs: hoursAgo(COMMITMENT_FRESH_HOURS + 1) }]
    expect(freshCommitments(items, now)).toEqual([])
  })

  it('keeps a proposal with no source timestamp, such as one from a meeting analysis', () => {
    const items = [{ label: 'דנה', content: 'לשלוח הצעה' }]
    expect(freshCommitments(items, now)).toEqual(items)
  })

  it('notifies only about the fresh half of a mixed batch', () => {
    const fresh = { label: 'דנה', content: 'חדש', sourceTs: hoursAgo(2) }
    const stale = { label: 'חרוזים', content: 'ישן', sourceTs: hoursAgo(9) }
    expect(freshCommitments([stale, fresh], now)).toEqual([fresh])
  })
})
