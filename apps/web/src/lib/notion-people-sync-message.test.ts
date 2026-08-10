import { describe, it, expect } from 'vitest'
import { notionPeopleSyncMessage } from './notion-people-sync-message'

const FSI = '\u2068'
const PDI = '\u2069'

describe('notionPeopleSyncMessage', () => {
  it('stays silent when every person matched', () => {
    expect(
      notionPeopleSyncMessage({ ok: true, propertyName: 'People', matched: ['Guy Gamzu'], unmatched: [] }),
    ).toBeNull()
  })

  it('stays silent when there is no result to report', () => {
    expect(notionPeopleSyncMessage(null)).toBeNull()
    expect(notionPeopleSyncMessage(undefined)).toBeNull()
  })

  it('names the people who were skipped on a partial push', () => {
    const msg = notionPeopleSyncMessage({
      ok: true,
      propertyName: 'People',
      matched: ['Guy Gamzu'],
      unmatched: ['Ghost Person'],
    })
    expect(msg).toContain('Ghost Person')
    expect(msg).toContain('לא נמצאו בספריית האנשים')
  })

  it('lists several skipped people separated by commas', () => {
    const msg = notionPeopleSyncMessage({ ok: false, reason: 'no-matching-people', unmatched: ['One', 'Two'] })
    expect(msg).toBe(
      `${FSI}One${PDI}, ${FSI}Two${PDI} לא נמצאו בספריית האנשים ב-Notion, ולכן השיוך שם לא עודכן`,
    )
  })

  it('isolates each Latin name so Hebrew punctuation is not reordered', () => {
    const msg = notionPeopleSyncMessage({ ok: true, unmatched: ['Guy Gamzu'] })!
    expect(msg).toContain(`${FSI}Guy Gamzu${PDI}`)
  })

  it('says nothing when the database has no people relation at all', () => {
    expect(notionPeopleSyncMessage({ ok: false, reason: 'no-people-relation' })).toBeNull()
  })

  it('falls back to a generic failure for an API or account problem', () => {
    expect(notionPeopleSyncMessage({ ok: false, reason: 'api', message: 'Notion API 500' })).toBe(
      'האנשים נשמרו, אבל השיוך שלהם ב-Notion נכשל',
    )
    expect(notionPeopleSyncMessage({ ok: false, reason: 'account' })).toBe(
      'האנשים נשמרו, אבל השיוך שלהם ב-Notion נכשל',
    )
  })

  it('still reports a no-match failure that carries no names', () => {
    expect(notionPeopleSyncMessage({ ok: false, reason: 'no-matching-people' })).toBe(
      'האנשים לא נמצאו בספריית האנשים ב-Notion, ולכן השיוך שם לא עודכן',
    )
  })

  it('ignores empty strings in the unmatched list', () => {
    expect(notionPeopleSyncMessage({ ok: true, unmatched: ['', ''] })).toBeNull()
  })
})
