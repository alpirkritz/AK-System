import { describe, expect, it } from 'vitest'
import { formatRecipients, owaMessageToHeader, type OwaMessage } from './owa-mail-source'

function makeMsg(overrides: Partial<OwaMessage> = {}): OwaMessage {
  return {
    Id: 'AAMkMsg1',
    ConversationId: 'CONV-1',
    Subject: 'Pentest results',
    BodyPreview: '  Here are the findings.  ',
    ReceivedDateTime: '2026-08-10T09:00:00Z',
    From: { EmailAddress: { Name: 'Dana Levi', Address: 'dana@pizzahut.com' } },
    ToRecipients: [{ EmailAddress: { Name: 'Alpir', Address: 'alpir@dragontail.com' } }],
    CcRecipients: [],
    ...overrides,
  }
}

describe('formatRecipients', () => {
  it('renders name + address', () => {
    expect(formatRecipients([{ EmailAddress: { Name: 'Dana Levi', Address: 'dana@x.com' } }])).toBe(
      'Dana Levi <dana@x.com>',
    )
  })

  it('collapses to the address when name equals address or is missing', () => {
    expect(formatRecipients([{ EmailAddress: { Address: 'a@x.com' } }])).toBe('a@x.com')
    expect(formatRecipients([{ EmailAddress: { Name: 'a@x.com', Address: 'a@x.com' } }])).toBe('a@x.com')
  })

  it('joins multiple recipients and drops empties', () => {
    expect(
      formatRecipients([
        { EmailAddress: { Name: 'A', Address: 'a@x.com' } },
        { EmailAddress: {} },
        { EmailAddress: { Name: 'B', Address: 'b@x.com' } },
      ]),
    ).toBe('A <a@x.com>, B <b@x.com>')
  })

  it('returns empty string for undefined', () => {
    expect(formatRecipients(undefined)).toBe('')
  })
})

describe('owaMessageToHeader', () => {
  it('maps a message into the archive header shape', () => {
    const h = owaMessageToHeader(makeMsg(), 'alpir@dragontail.com')
    expect(h).toEqual({
      accountEmail: 'alpir@dragontail.com',
      messageId: 'AAMkMsg1',
      threadId: 'CONV-1',
      subject: 'Pentest results',
      from: 'Dana Levi <dana@pizzahut.com>',
      to: 'Alpir <alpir@dragontail.com>',
      cc: '',
      date: '2026-08-10T09:00:00.000Z',
      snippet: 'Here are the findings.',
    })
  })

  it('falls back to the message id when there is no conversation id', () => {
    const h = owaMessageToHeader(makeMsg({ ConversationId: undefined }), 'a@x.com')
    expect(h?.threadId).toBe('AAMkMsg1')
  })

  it('returns null without an id', () => {
    expect(owaMessageToHeader(makeMsg({ Id: '' as string }), 'a@x.com')).toBeNull()
  })

  it('tolerates missing optional fields', () => {
    const h = owaMessageToHeader({ Id: 'x', ReceivedDateTime: '2026-01-01T00:00:00Z' }, 'a@x.com')
    expect(h).toMatchObject({ subject: '', from: '', to: '', cc: '', snippet: '', threadId: 'x' })
  })
})
