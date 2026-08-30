import { describe, expect, it } from 'vitest'
import {
  expandNameQuery,
  queryMatchesPersonName,
  queryMatchesText,
  titlesShareKnownPerson,
} from './person-name-match'

describe('expandNameQuery', () => {
  it('maps שני to shani and back', () => {
    expect(expandNameQuery('שני')).toEqual(expect.arrayContaining(['שני', 'shani']))
    expect(expandNameQuery('Shani')).toEqual(expect.arrayContaining(['shani', 'שני']))
  })
})

describe('queryMatchesPersonName', () => {
  it('matches Hebrew query to English person name', () => {
    expect(queryMatchesPersonName('Shani Asaraf', 'שני')).toBe(true)
    expect(queryMatchesPersonName('Shani Asaraf', 'shani')).toBe(true)
    expect(queryMatchesPersonName('Dana Levi', 'שני')).toBe(false)
  })
})

describe('queryMatchesText', () => {
  it('matches שני against an English meeting title', () => {
    expect(queryMatchesText('Status update with Shani', 'שני')).toBe(true)
  })
})

describe('titlesShareKnownPerson', () => {
  it('links calendar 1:1 to Notion status-update when both name Shani', () => {
    expect(
      titlesShareKnownPerson('Shani & Alpir 1:1', 'Status update with Shani', ['Shani Asaraf']),
    ).toBe(true)
  })

  it('does not merge unrelated same-day Algo meetings', () => {
    expect(
      titlesShareKnownPerson('Algo Weekly', 'Algo 4.0 - Sync meeting updates', ['Shani Asaraf']),
    ).toBe(false)
  })
})
