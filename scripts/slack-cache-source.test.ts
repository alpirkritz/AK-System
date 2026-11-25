import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as v8 from 'v8'
import { describe, expect, it } from 'vitest'
import {
  decodeSlackBlob,
  extractSlackSnapshot,
  findSlackBlob,
  loadSentState,
  onlyNewMessages,
  plainSlackText,
  saveSentState,
  unsnappy,
} from './slack-cache-source'

/** A tiny redux-shaped state like the Slack desktop app persists. */
function fixtureState() {
  const member = (id: string, real: string, email: string, extra: Record<string, unknown> = {}) => ({
    id,
    real_name: real,
    profile: { real_name: real, display_name: real.split(' ')[0], email, title: 'PM' },
    ...extra,
  })
  return {
    bootData: { user_id: 'USELF', enterprise_id: 'E1' },
    members: {
      USELF: member('USELF', 'Alpir Kritzler', 'alpir@x.com', { is_self: true }),
      UDANA: member('UDANA', 'Dana Levi', 'dana@x.com'),
      URON: member('URON', 'Ron Cohen', 'ron@x.com'),
      UBOT: member('UBOT', 'Jira Bot', '', { is_bot: true }),
    },
    channels: {
      D1: { id: 'D1', is_im: true, user: 'UDANA', name: 'UDANA' },
      G1: { id: 'G1', is_mpim: true, name: 'mpdm-x' },
      C1: { id: 'C1', name: 'ops', is_channel: true, is_private: false },
    },
    messages: {
      D1: {
        '1764000000.000100': { ts: '1764000000.000100', user: 'UDANA', text: 'תוכל לשלוח לי את הדוח עד מחר?' },
        '1764000060.000200': { ts: '1764000060.000200', user: 'USELF', text: 'כן, אשלח' },
      },
      G1: {
        '1764000100.000100': { ts: '1764000100.000100', user: 'URON', text: 'hey <@UDANA>' },
      },
      C1: {
        '1764000200.000100': { ts: '1764000200.000100', user: 'URON', text: 'joined', subtype: 'channel_join' },
        '1764000300.000100': { ts: '1764000300.000100', user: 'UBOT', text: 'ticket created' },
        '1764000400.000100': { ts: '1764000400.000100', user: 'URON', text: '<@USELF> see <https://a.io|the doc> &amp; reply', thread_ts: '1764000400.000100' },
      },
    },
  }
}

/** Blink envelope (ff 15 + padding) around a Node V8 serialization, like Chromium writes. */
function blinkWrap(state: unknown): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0x15, 0xfe, 0x00, 0x00, 0x00]), v8.serialize(state)])
}

describe('slack-cache-source', () => {
  it('unsnappy decodes literals and back-references', () => {
    // "abcabcabcd": literal "abc", copy len 6 offset 3, literal "d" — uncompressed length 10.
    const bytes = Uint8Array.from([10, 0x08, 0x61, 0x62, 0x63, 0x09, 0x03, 0x00, 0x64])
    expect(unsnappy(bytes).toString()).toBe('abcabcabcd')
  })

  it('decodes a Blink-wrapped V8 blob and rejects a non-Slack payload', () => {
    const state = decodeSlackBlob(blinkWrap(fixtureState()))
    expect(Object.keys(state.messages as object)).toEqual(['D1', 'G1', 'C1'])
    expect(() => decodeSlackBlob(blinkWrap({ hello: 1 }))).toThrow(/format changed/)
  })

  it('extracts conversations by kind, members, and clean messages', () => {
    const p = extractSlackSnapshot(fixtureState())
    expect(p.teamId).toBe('E1')
    expect(p.selfUserId).toBe('USELF')
    expect(p.conversations).toEqual([
      { channelId: 'D1', kind: 'dm', name: 'Dana Levi', isPrivate: true, memberIds: ['UDANA'], memberNames: ['Dana Levi'] },
      { channelId: 'G1', kind: 'group_dm', name: 'Ron Cohen', isPrivate: true, memberIds: ['URON'], memberNames: ['Ron Cohen'] },
      { channelId: 'C1', kind: 'channel', name: 'ops', isPrivate: false, memberIds: [], memberNames: [] },
    ])
    // join + bot skipped; mentions and links made readable.
    expect(p.messages.map((m) => m.text)).toEqual([
      'תוכל לשלוח לי את הדוח עד מחר?',
      'כן, אשלח',
      'hey @Dana Levi',
      '@Alpir Kritzler see the doc & reply',
    ])
    expect(p.messages[3]).toMatchObject({ channelId: 'C1', userId: 'URON', threadTs: '1764000400.000100' })
    expect(p.members.find((m) => m.userId === 'USELF')).toMatchObject({ isSelf: true, email: 'alpir@x.com' })
    expect(p.members.some((m) => m.userId === 'UBOT')).toBe(false)
  })

  it('plainSlackText falls back to the id for an unknown member', () => {
    expect(plainSlackText('<@U999> <!here>', () => '')).toBe('@U999 @here')
  })

  it('sends only messages newer than the last run, per conversation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-state-'))
    const file = path.join(dir, 'state.json')
    const p = extractSlackSnapshot(fixtureState())
    expect(onlyNewMessages(p, loadSentState(file)).messages).toHaveLength(4)
    saveSentState(p, {}, file)
    expect(onlyNewMessages(p, loadSentState(file)).messages).toHaveLength(0)
  })

  it('finds the newest blob file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-blob-'))
    fs.mkdirSync(path.join(dir, '01'))
    fs.mkdirSync(path.join(dir, '2f'))
    fs.writeFileSync(path.join(dir, '01', 'old'), 'x')
    fs.writeFileSync(path.join(dir, '2f', 'new'), 'y')
    fs.utimesSync(path.join(dir, '01', 'old'), new Date(1000), new Date(1000))
    expect(findSlackBlob(dir)).toBe(path.join(dir, '2f', 'new'))
    expect(() => findSlackBlob(path.join(dir, 'missing'))).toThrow(/not found/)
  })
})
