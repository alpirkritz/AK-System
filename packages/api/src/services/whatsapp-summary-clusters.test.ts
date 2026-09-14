import { describe, expect, it } from 'vitest'
import {
  formatClusterSummaryMessage,
  formatQuietDayClusterMessage,
  partitionDueSummaries,
  QUIET_DAY_BODY,
  type DueSummaryRow,
} from './whatsapp-summary-clusters'

function row(partial: Partial<DueSummaryRow> & Pick<DueSummaryRow, 'jid' | 'name'>): DueSummaryRow {
  return {
    enabled: true,
    groupTimes: [],
    labelId: null,
    labelName: null,
    labelTimes: [],
    aggregateSummaries: false,
    ...partial,
  }
}

describe('partitionDueSummaries', () => {
  it('clusters any label with the flag and two+ due enabled groups, regardless of name', () => {
    const { clusters, singles } = partitionDueSummaries(
      [
        row({
          jid: 'gan-parents@g.us',
          name: 'הורים',
          labelId: 'wl_a',
          labelName: 'תווית א',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
        row({
          jid: 'gan-staff@g.us',
          name: 'צוות',
          labelId: 'wl_a',
          labelName: 'תווית א',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
        row({
          jid: 'school-parents@g.us',
          name: 'הורים ביה״ס',
          labelId: 'wl_b',
          labelName: 'תווית ב',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
        row({
          jid: 'school-updates@g.us',
          name: 'עדכונים',
          labelId: 'wl_b',
          labelName: 'תווית ב',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
      ],
      '20:00',
    )

    expect(clusters).toHaveLength(2)
    expect(clusters.map((c) => c.labelId).sort()).toEqual(['wl_a', 'wl_b'])
    expect(singles).toEqual([])
  })

  it('leaves unlabeled, flag-off, and singleton clustered labels as per-group singles', () => {
    const { clusters, singles } = partitionDueSummaries(
      [
        row({ jid: 'plain@g.us', name: 'רגילה', labelTimes: ['20:00'] }),
        row({
          jid: 'off-a@g.us',
          name: 'עבודה א',
          labelId: 'wl_off',
          labelName: 'עבודה',
          labelTimes: ['20:00'],
          aggregateSummaries: false,
        }),
        row({
          jid: 'off-b@g.us',
          name: 'עבודה ב',
          labelId: 'wl_off',
          labelName: 'עבודה',
          labelTimes: ['20:00'],
          aggregateSummaries: false,
        }),
        row({
          jid: 'solo@g.us',
          name: 'יחידה',
          labelId: 'wl_solo',
          labelName: 'יחידה',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
      ],
      '20:00',
    )

    expect(clusters).toEqual([])
    expect(singles.map((s) => s.jid).sort()).toEqual(['off-a@g.us', 'off-b@g.us', 'plain@g.us', 'solo@g.us'])
  })

  it('omits disabled groups and groups whose effective times miss the slot', () => {
    const { clusters, singles } = partitionDueSummaries(
      [
        row({
          jid: 'due-a@g.us',
          name: 'A',
          labelId: 'wl',
          labelName: 'אשכול',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
        row({
          jid: 'due-b@g.us',
          name: 'B',
          labelId: 'wl',
          labelName: 'אשכול',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
        row({
          jid: 'disabled@g.us',
          name: 'כבוי',
          enabled: false,
          labelId: 'wl',
          labelName: 'אשכול',
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
        row({
          jid: 'morning@g.us',
          name: 'בוקר',
          labelId: 'wl',
          labelName: 'אשכול',
          groupTimes: ['08:00'],
          labelTimes: ['20:00'],
          aggregateSummaries: true,
        }),
      ],
      '20:00',
    )

    expect(clusters).toHaveLength(1)
    expect(clusters[0].groups.map((g) => g.jid).sort()).toEqual(['due-a@g.us', 'due-b@g.us'])
    expect(singles).toEqual([])
  })

  it('treats slot null as on-demand: every enabled group is due', () => {
    const { clusters, singles } = partitionDueSummaries(
      [
        row({
          jid: 'a@g.us',
          name: 'A',
          labelId: 'wl',
          labelName: 'X',
          labelTimes: ['08:00'],
          aggregateSummaries: true,
        }),
        row({
          jid: 'b@g.us',
          name: 'B',
          labelId: 'wl',
          labelName: 'X',
          labelTimes: ['08:00'],
          aggregateSummaries: true,
        }),
        row({ jid: 'c@g.us', name: 'C', enabled: false, labelTimes: ['08:00'] }),
      ],
      null,
    )

    expect(clusters).toHaveLength(1)
    expect(clusters[0].groups).toHaveLength(2)
    expect(singles).toEqual([])
  })
})

describe('formatClusterSummaryMessage', () => {
  it('uses the provided cluster name in the header', () => {
    const text = formatClusterSummaryMessage('התווית שלי', 'היה טיול.')
    expect(text).toContain('📋 סיכום — התווית שלי')
    expect(text).toContain('היה טיול.')
  })
})

describe('formatQuietDayClusterMessage', () => {
  it('sends a real briefing that says nothing happened, not a blank body', () => {
    const text = formatQuietDayClusterMessage('עומרי')
    expect(text).toContain('📋 סיכום — עומרי')
    expect(text).toContain(QUIET_DAY_BODY)
    expect(text.replace(/^📋 סיכום — עומרי\s*/, '').trim().length).toBeGreaterThan(0)
  })
})
