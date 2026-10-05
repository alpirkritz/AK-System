import { describe, expect, it } from 'vitest'
import { pickAttentionShift } from './attention-shift'

describe('pickAttentionShift', () => {
  it('returns null when nobody warmed or cooled', () => {
    expect(pickAttentionShift([])).toBeNull()
    expect(
      pickAttentionShift([
        { name: 'Guy Gamzu', trend: 'stable', recentAvg: 0.4, olderAvg: 0.4, dataReason: 'יציב' },
        { name: 'Dana', trend: null, recentAvg: 0.1, olderAvg: null, dataReason: '' },
      ]),
    ).toBeNull()
  })

  it('names the largest real shift and counts only other movers', () => {
    const shift = pickAttentionShift([
      { name: 'Guy Gamzu', trend: 'stable', recentAvg: 0.9, olderAvg: 0, dataReason: 'לא זז' },
      { name: 'Dana', trend: 'cooling', recentAvg: 0.1, olderAvg: 0.6, dataReason: 'הציון ירד מ־8 ל־3.' },
      { name: 'Ori', trend: 'warming', recentAvg: 0.4, olderAvg: 0.1, dataReason: 'הציון עלה מ־4 ל־7.' },
    ])
    expect(shift).toEqual({
      name: 'Dana',
      verb: 'מתקרר',
      dataReason: 'הציון ירד מ־8 ל־3.',
      rest: 1,
    })
  })

  it('uses מתחמם for a lone warming card and drops a blank reason', () => {
    expect(
      pickAttentionShift([
        { name: 'Noa', trend: 'warming', recentAvg: 0.5, olderAvg: 0.1, dataReason: '   ' },
      ]),
    ).toEqual({ name: 'Noa', verb: 'מתחמם', dataReason: '', rest: 0 })
  })
})
