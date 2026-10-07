import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'

process.env.BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'test'
process.env.SELF_JID = '972500000000@s.whatsapp.net'
process.env.ALLOWED_JIDS = ''
process.env.WHATSAPP_ALLOWED_GROUP_JIDS = '120363411443506535@g.us, 999@g.us'

delete process.env.BRIDGE_CONFIG_PATH

const { config, isAllowedGroupJid, isSelfChatJid } = await import('./config.js')

describe('configPath', () => {
  it('defaults to a sibling of the auth-state directory', () => {
    expect(config.configPath).toBe(join(dirname(config.authStatePath), 'config'))
  })
})

describe('isAllowedGroupJid', () => {
  it('allows a JID present in WHATSAPP_ALLOWED_GROUP_JIDS', () => {
    expect(isAllowedGroupJid('120363411443506535@g.us')).toBe(true)
  })

  it('allows a second configured group JID', () => {
    expect(isAllowedGroupJid('999@g.us')).toBe(true)
  })

  it('rejects a group JID that is not on the allow-list', () => {
    expect(isAllowedGroupJid('111111111111111111@g.us')).toBe(false)
  })

  it('rejects the self-chat JID for the group-send capability (separate allow-list)', () => {
    expect(isAllowedGroupJid('972500000000@s.whatsapp.net')).toBe(false)
  })
})

describe('isSelfChatJid — unaffected by the new group allow-list', () => {
  it('still allows the configured self-chat JID', () => {
    expect(isSelfChatJid('972500000000@s.whatsapp.net')).toBe(true)
  })

  it('still rejects an arbitrary group JID for self-chat', () => {
    expect(isSelfChatJid('120363411443506535@g.us')).toBe(false)
  })
})
