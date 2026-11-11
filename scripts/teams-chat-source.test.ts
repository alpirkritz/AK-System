import { describe, expect, it } from 'vitest'
import { graphChatToInfo, graphMessageToRow, stripHtml, type GraphChat, type GraphMessage } from './teams-chat-source'

describe('stripHtml', () => {
  it('turns block tags into newlines and strips the rest', () => {
    expect(stripHtml('<p>Hi</p><div>there</div>')).toBe('Hi\nthere')
    expect(stripHtml('a<br/>b')).toBe('a\nb')
  })
  it('decodes common entities', () => {
    expect(stripHtml('Tom &amp; Jerry &lt;3 &#33;')).toBe('Tom & Jerry <3 !')
  })
  it('returns empty for undefined', () => {
    expect(stripHtml(undefined)).toBe('')
  })
})

describe('graphChatToInfo', () => {
  const chat: GraphChat = {
    id: '19:abc',
    topic: '  Pentest crew  ',
    chatType: 'group',
    members: [
      { displayName: 'Dana Levi', email: 'Dana@PizzaHut.com' },
      { displayName: 'Alpir', email: undefined },
    ],
  }
  it('extracts member names, topic, and a name→email map', () => {
    const info = graphChatToInfo(chat)
    expect(info.chatId).toBe('19:abc')
    expect(info.topic).toBe('Pentest crew')
    expect(info.memberNames).toEqual(['Dana Levi', 'Alpir'])
    expect(info.emailByName.get('dana levi')).toBe('dana@pizzahut.com')
    expect(info.emailByName.has('alpir')).toBe(false)
  })
  it('nulls an empty topic and defaults the type', () => {
    const info = graphChatToInfo({ id: '19:x', members: [] })
    expect(info.topic).toBeNull()
    expect(info.chatType).toBe('group')
  })
})

describe('graphMessageToRow', () => {
  const emailByName = new Map([['dana levi', 'dana@pizzahut.com']])
  const base: GraphMessage = {
    id: 'm1',
    createdDateTime: '2026-08-10T09:00:00Z',
    messageType: 'message',
    from: { user: { displayName: 'Dana Levi', id: 'u1' } },
    body: { contentType: 'html', content: '<p>Can you send the report?</p>' },
  }

  it('maps a message and resolves email from the member map', () => {
    expect(graphMessageToRow(base, emailByName)).toEqual({
      messageId: 'm1',
      fromName: 'Dana Levi',
      fromEmail: 'dana@pizzahut.com',
      text: 'Can you send the report?',
      ts: Date.parse('2026-08-10T09:00:00Z'),
    })
  })
  it('prefers an email on the identity itself', () => {
    const r = graphMessageToRow({ ...base, from: { user: { displayName: 'X', email: 'x@y.com' } } }, emailByName)
    expect(r?.fromEmail).toBe('x@y.com')
  })
  it('skips deleted, system, authorless, and empty messages', () => {
    expect(graphMessageToRow({ ...base, deletedDateTime: '2026-01-01T00:00:00Z' }, emailByName)).toBeNull()
    expect(graphMessageToRow({ ...base, messageType: 'systemEventMessage' }, emailByName)).toBeNull()
    expect(graphMessageToRow({ ...base, from: {} }, emailByName)).toBeNull()
    expect(graphMessageToRow({ ...base, body: { content: '<div></div>' } }, emailByName)).toBeNull()
  })
})
