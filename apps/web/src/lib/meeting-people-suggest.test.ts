import { describe, expect, it } from 'vitest'
import { filterPeople, recentPersonIds, selectedExactName } from './meeting-people-suggest'

const people = [
  { id: 'a', name: 'Dana Cohen', company: 'Acme', role: 'CEO' },
  { id: 'b', name: 'Ori Levi', company: 'Beta', role: 'Eng' },
  { id: 'c', name: 'Noa Bar', company: null, role: 'Design' },
  { id: 'd', name: 'Gal', company: 'Acme', role: null },
  { id: 'e', name: 'Tal', company: null, role: null },
  { id: 'f', name: 'Roni', company: null, role: null },
  { id: 'g', name: 'Shai', company: null, role: null },
  { id: 'h', name: 'Yael', company: null, role: null },
  { id: 'i', name: 'Michal', company: null, role: null },
]

describe('recentPersonIds', () => {
  it('walks newest meetings first, skips selected and unknown ids, and caps at six', () => {
    const ids = recentPersonIds(
      [
        { date: '2026-01-01', peopleIds: ['a', 'missing', 'b'] },
        { date: '2026-06-01', peopleIds: ['c', 'a', 'd', 'e', 'f', 'g', 'h', 'i'] },
      ],
      new Set(people.map((person) => person.id)),
      ['c'],
    )
    expect(ids).toEqual(['a', 'd', 'e', 'f', 'g', 'h'])
  })
})

describe('filterPeople', () => {
  it('matches name, company, or role and hides people already selected', () => {
    expect(filterPeople(people, ['a'], 'acme').map((person) => person.id)).toEqual(['d'])
    expect(filterPeople(people, [], 'design').map((person) => person.id)).toEqual(['c'])
    expect(filterPeople(people, [], 'ori').map((person) => person.id)).toEqual(['b'])
    expect(filterPeople(people, [], '')).toEqual([])
  })

  it('returns at most eight rows', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      name: `Person ${index}`,
    }))
    expect(filterPeople(many, [], 'person')).toHaveLength(8)
  })
})

describe('selectedExactName', () => {
  it('returns the selected person only on an exact name', () => {
    expect(selectedExactName(people, ['a'], 'dana cohen')).toBe('Dana Cohen')
    expect(selectedExactName(people, ['a'], 'dana')).toBeNull()
    expect(selectedExactName(people, [], 'dana cohen')).toBeNull()
  })
})
