import { describe, expect, it } from 'vitest'
import { pickAttentionShift, type AttentionShiftCard } from './attention-shift'

const card = (name: string, attention: AttentionShiftCard['attention'], dataReason = ''): AttentionShiftCard => ({ name, attention, dataReason })

describe('pickAttentionShift', () => {
  it('returns null when nobody clearly needs a 1:1', () => {
    expect(pickAttentionShift([])).toBeNull()
    expect(
      pickAttentionShift([
        card('Guy', { status: 'steady', severity: 0, suppressed: null }),
        card('Dana', null),
        // mild flag: on the relationships page, not on the dashboard
        card('Yossi', { status: 'needs_1on1', severity: 1.2, suppressed: null }),
        card('Noa', { status: 'good', severity: 0, suppressed: null }),
        // booked or already seen
        card('Ori', { status: 'needs_1on1', severity: 3, suppressed: 'scheduled' }),
        card('Tal', { status: 'needs_1on1', severity: 3, suppressed: 'acknowledged' }),
      ]),
    ).toBeNull()
  })

  it('names the sharpest flag and counts only other sharp ones', () => {
    expect(
      pickAttentionShift([
        card('Ori', { status: 'needs_1on1', severity: 2.1, suppressed: null }, 'b'),
        card('Dana', { status: 'needs_1on1', severity: 3.4, suppressed: null }, 'הטון בשיחות האחרונות ירד.'),
        card('Yossi', { status: 'needs_1on1', severity: 1, suppressed: null }),
      ]),
    ).toEqual({ name: 'Dana', dataReason: 'הטון בשיחות האחרונות ירד.', rest: 1 })
  })
})
