import { describe, expect, it } from 'vitest'
import { buildCommitmentNotification } from './commitments'

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
