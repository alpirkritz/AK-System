import { describe, expect, it } from 'vitest'
import { isSelfPersonName, matchTaskAssigneeId, omitSelfParticipants, ownerIdentityPrompt } from './self-person'

describe('owner identity', () => {
  it('recognizes the owner in Hebrew and English, including the first name alone', () => {
    expect(isSelfPersonName('Alpir Kritzler')).toBe(true)
    expect(isSelfPersonName('אלפיר קריצלר')).toBe(true)
    expect(isSelfPersonName('Alpir')).toBe(true)
    expect(isSelfPersonName('אלפיר')).toBe(true)
    expect(isSelfPersonName('  אלפיר  ')).toBe(true)
  })

  it('does not treat a different person or a company as the owner', () => {
    expect(isSelfPersonName('דנה')).toBe(false)
    expect(isSelfPersonName('Alpir Consulting')).toBe(false)
    expect(isSelfPersonName('שני ואלפיר')).toBe(false)
    expect(isSelfPersonName('')).toBe(false)
    expect(isSelfPersonName(null)).toBe(false)
  })

  it('drops only the owner from a participant list', () => {
    const left = omitSelfParticipants([
      { name: 'אלפיר', confirmed: true },
      { name: 'דנה', confirmed: false },
      { name: 'Alpir Kritzler', confirmed: true },
    ])
    expect(left.map((person) => person.name)).toEqual(['דנה'])
  })

  it('assigns his own task to the canonical row, not a duplicate first-name contact', () => {
    const people = [
      { id: 'dup', name: 'אלפיר' },
      { id: 'me', name: 'Alpir Kritzler' },
      { id: 'dana', name: 'דנה' },
    ]
    expect(matchTaskAssigneeId('אלפיר', people)).toBe('me')
    expect(matchTaskAssigneeId('Alpir Kritzler', people)).toBe('me')
    expect(matchTaskAssigneeId('דנה', people)).toBe('dana')
    expect(matchTaskAssigneeId('מישהו', people)).toBe('')
  })

  it('tells every prompt who the user is and that recordings already include him', () => {
    const block = ownerIdentityPrompt()
    expect(block).toContain('Alpir Kritzler')
    expect(block).toContain('אלפיר קריצלר')
    expect(block).toContain('Every recorded conversation was recorded by him')
  })
})
