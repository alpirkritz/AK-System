import { describe, expect, it } from 'vitest'
import { historyToEvent, parseSlackLocalConfig } from './slack-local-source'

describe('parseSlackLocalConfig', () => {
  const cfg = JSON.stringify({
    teams: {
      T01: { id: 'T01', name: 'Dragontail', token: 'xoxc-abc' },
      T02: { id: 'T02', name: 'Side', token: 'xoxc-def' },
      T03: { id: 'T03', name: 'Bad', token: 'xoxb-nope' }, // not a web token
      T04: { name: 'NoId', token: 'xoxc-ghi' }, // missing id
    },
    lastActiveTeamId: 'T01',
  })

  it('extracts only valid xoxc teams with ids', () => {
    expect(parseSlackLocalConfig(cfg)).toEqual([
      { teamId: 'T01', teamName: 'Dragontail', token: 'xoxc-abc' },
      { teamId: 'T02', teamName: 'Side', token: 'xoxc-def' },
    ])
  })

  it('falls back to id for a missing name', () => {
    const r = parseSlackLocalConfig(JSON.stringify({ teams: { T9: { id: 'T9', token: 'xoxc-x' } } }))
    expect(r).toEqual([{ teamId: 'T9', teamName: 'T9', token: 'xoxc-x' }])
  })

  it('returns [] for null, garbage, or missing teams', () => {
    expect(parseSlackLocalConfig(null)).toEqual([])
    expect(parseSlackLocalConfig('not json')).toEqual([])
    expect(parseSlackLocalConfig('{}')).toEqual([])
  })
})

describe('historyToEvent', () => {
  it('maps a plain message', () => {
    expect(historyToEvent({ type: 'message', user: 'U1', text: 'hi', ts: '123.456' }, 'C1')).toEqual({
      type: 'message',
      channel: 'C1',
      user: 'U1',
      text: 'hi',
      ts: '123.456',
      thread_ts: undefined,
      edited: undefined,
      subtype: undefined,
    })
  })

  it('marks bot messages so ingest skips them', () => {
    const e = historyToEvent({ user: 'U1', text: 'x', ts: '1.0', bot_id: 'B1' }, 'C1')
    expect(e?.subtype).toBe('bot_message')
  })

  it('carries thread + edited through', () => {
    const e = historyToEvent({ user: 'U1', text: 'x', ts: '2.0', thread_ts: '1.0', edited: { ts: '3.0' } }, 'C1')
    expect(e).toMatchObject({ thread_ts: '1.0', edited: { ts: '3.0' } })
  })

  it('returns null without a ts', () => {
    expect(historyToEvent({ user: 'U1', text: 'x' }, 'C1')).toBeNull()
  })
})
