import { describe, expect, it } from 'vitest'
import { titlesShareTopic, topicTokens } from './topic-match'

describe('topicTokens', () => {
  it('keeps the DD acronym and drops generic release words', () => {
    expect(topicTokens('Follow up DD release discussion')).toEqual(['dd'])
  })

  it('keeps algo and drops the version and sync words', () => {
    expect(topicTokens('Algo 4.0 - Sync meeting updates')).toEqual(['algo'])
  })
})

describe('titlesShareTopic', () => {
  it('matches another DD title and rejects Algo titles', () => {
    expect(titlesShareTopic('Follow up DD release discussion', 'DD sync')).toBe(true)
    expect(titlesShareTopic('Follow up DD release discussion', 'Algo 4 Milestones timelines')).toBe(false)
    expect(titlesShareTopic('Follow up DD release discussion', 'Algo 4.0 - Sync meeting updates')).toBe(false)
  })
})
