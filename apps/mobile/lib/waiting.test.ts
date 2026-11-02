import { describe, expect, it } from 'vitest'
import type { MobileWaitingBuckets, MobileWaitingItem } from './data'
import { dueLabel, dueNow, groupByPersonUrgentFirst } from './waiting'

const item = (id: string, personId: string): MobileWaitingItem => ({
  kind: 'task', id, title: id, personId, personName: personId, dueDate: null, source: 'manual', sourceLabel: null, meetingId: null,
})
const empty: MobileWaitingBuckets = { overdue: [], today: [], thisWeek: [], later: [], noDate: [] }

describe('waiting helpers', () => {
  it('dueNow is late then today', () => {
    const b = { ...empty, overdue: [item('a', 'x')], today: [item('b', 'y')], thisWeek: [item('c', 'z')] }
    expect(dueNow(b).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('puts people with something due now first', () => {
    const b = { ...empty, today: [item('b', 'y')], thisWeek: [item('c', 'z'), item('d', 'y')] }
    const groups = groupByPersonUrgentFirst(b)
    expect(groups.map((g) => g.personId)).toEqual(['y', 'z'])
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['b', 'd'])
  })

  it('formats due labels', () => {
    expect(dueLabel('2026-11-02')).toBe('עד 2.11')
    expect(dueLabel(null)).toBe('')
  })
})
