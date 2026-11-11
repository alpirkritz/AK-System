import { describe, expect, it } from 'vitest'
import { bareUserJid, routeSelfChatJid } from './self-chat.js'

const PN = '972501234567@s.whatsapp.net'
const LID = '226855995088946@lid'

describe('routeSelfChatJid', () => {
  it('sends the owner phone JID to the LID, including a device suffix', () => {
    expect(routeSelfChatJid('972501234567:18@s.whatsapp.net', PN, LID)).toBe(LID)
    expect(routeSelfChatJid(PN, PN, LID)).toBe(LID)
  })

  it('keeps an explicit LID and strips its device suffix', () => {
    expect(routeSelfChatJid('226855995088946:4@lid', PN, LID)).toBe(LID)
  })

  it('does not rewrite when no LID is known', () => {
    expect(routeSelfChatJid(PN, PN, '')).toBe(PN)
  })

  it('does not rewrite a different jid', () => {
    expect(routeSelfChatJid('120363012345678901@g.us', PN, LID)).toBe('120363012345678901@g.us')
  })
})

describe('bareUserJid', () => {
  it('strips the device', () => {
    expect(bareUserJid('972501234567:18@s.whatsapp.net')).toBe(PN)
  })
})
