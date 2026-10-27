import { describe, expect, it } from 'vitest'
import { pickAttentionShift } from './attention-shift'

describe('pickAttentionShift', () => {
  it('returns null when nobody dropped sharply', () => {
    expect(pickAttentionShift([])).toBeNull()
    expect(
      pickAttentionShift([
        { name: 'Guy Gamzu', trend: 'stable', recentAvg: 0.4, olderAvg: 0.4, dataReason: 'יציב' },
        { name: 'Dana', trend: null, recentAvg: 0.1, olderAvg: null, dataReason: '' },
        // mild cooling: on the relationships page, not on the dashboard
        { name: 'Yossi', trend: 'cooling', recentAvg: 0.2, olderAvg: 0.5, dataReason: 'הציון ירד מ־7 ל־6.' },
        // warming never interrupts
        { name: 'Noa', trend: 'warming', recentAvg: 0.9, olderAvg: 0.1, dataReason: 'הציון עלה.' },
      ]),
    ).toBeNull()
  })

  it('names the sharpest drop and counts only other sharp drops', () => {
    expect(
      pickAttentionShift([
        { name: 'Dana', trend: 'cooling', recentAvg: -0.2, olderAvg: 0.5, dataReason: 'הציון ירד מ־8 ל־3.' },
        { name: 'Ori', trend: 'cooling', recentAvg: 0, olderAvg: 0.5, dataReason: 'הציון ירד מ־8 ל־5.' },
        { name: 'Yossi', trend: 'cooling', recentAvg: 0.3, olderAvg: 0.5, dataReason: 'קל' },
      ]),
    ).toEqual({ name: 'Dana', verb: 'מתקרר', dataReason: 'הציון ירד מ־8 ל־3.', rest: 1 })
  })

  it('ignores a drop built on a single recent meeting', () => {
    expect(
      pickAttentionShift([
        { name: 'Dana', trend: 'cooling', recentAvg: -0.4, olderAvg: 0.5, recentCount: 1, dataReason: 'x' },
      ]),
    ).toBeNull()
  })
})
