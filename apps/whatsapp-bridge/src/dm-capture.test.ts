import { describe, expect, it, beforeEach } from 'vitest'

process.env.BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'test'
process.env.AUTH_STATE_PATH = process.env.AUTH_STATE_PATH || '/tmp/ak-bridge-dm-test'

const { reloadDmConfig, resolveCapturedDm, phoneJidForLid, enqueueDmMessage, drainDmQueue } = await import('./dm-capture.js')

const PN = '972501234567@s.whatsapp.net'
const LID = '11122233344455@lid'
const SELF = '972500000000@s.whatsapp.net'
const isSelf = (jid: string) => jid.startsWith('972500000000')

describe('resolveCapturedDm', () => {
  beforeEach(() => {
    reloadDmConfig([PN])
  })

  it('captures an allowlisted phone chat, including a device suffix', () => {
    expect(resolveCapturedDm('972501234567:3@s.whatsapp.net', [], isSelf)).toEqual({ jid: PN, altJid: null })
  })

  it('resolves an @lid chat to the phone JID through the contact store', () => {
    expect(phoneJidForLid(LID, [{ id: PN, lid: LID }])).toBe(PN)
    expect(resolveCapturedDm(LID, [{ id: PN, lid: LID }], isSelf)).toEqual({ jid: PN, altJid: LID })
  })

  it('ignores chats that are not allowlisted, groups, and self-chat', () => {
    expect(resolveCapturedDm('972509999999@s.whatsapp.net', [], isSelf)).toBeNull()
    expect(resolveCapturedDm(LID, [], isSelf)).toBeNull()
    expect(resolveCapturedDm('123@g.us', [], isSelf)).toBeNull()
    reloadDmConfig([PN, SELF])
    expect(resolveCapturedDm(SELF, [], isSelf)).toBeNull()
  })

  it('captures nothing once the allowlist is empty', () => {
    reloadDmConfig([])
    expect(resolveCapturedDm(PN, [], isSelf)).toBeNull()
  })
})

describe('DM queue', () => {
  it('dedupes by message id until drained', () => {
    const m = { id: 'a', jid: PN, altJid: null, fromMe: false, text: 'hi', timestamp: 1 }
    enqueueDmMessage(m)
    enqueueDmMessage(m)
    expect(drainDmQueue()).toHaveLength(1)
    expect(drainDmQueue()).toHaveLength(0)
  })
})
