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

  it('treats a version as part of the project name', () => {
    expect(titlesShareTopic('Algo 4 Milestones timelines', 'Features for Algo 4.0')).toBe(true)
    expect(titlesShareTopic('Algo v4 planning', 'Algo 4.0 - Sync meeting updates')).toBe(true)
    expect(titlesShareTopic('Algo 4.0 - Sync meeting updates', 'Algo core sync')).toBe(false)
    expect(titlesShareTopic('Algo weekly', 'Fix regression in Algo 4.0')).toBe(false)
    expect(titlesShareTopic('Algo core sync', 'Algo (core) latency fix')).toBe(true)
    expect(titlesShareTopic('Algo 4.0 sync', 'Algo 5 kickoff')).toBe(false)
  })

  it('still matches versioned and unversioned titles through another shared token', () => {
    expect(titlesShareTopic('Algo 4.0 pricing review', 'Algo pricing')).toBe(true)
  })
})
