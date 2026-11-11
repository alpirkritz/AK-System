import { describe, expect, it } from 'vitest'
import { deterministicReplyNeed } from './email-reply-need'

describe('deterministicReplyNeed', () => {
  it('drops noreply and FYI before any ask', () => {
    expect(deterministicReplyNeed({
      from: 'News <noreply@vendor.com>', subject: 'Can you look?', snippet: null, commitmentLinked: false,
    })).toBe('fyi')
    expect(deterministicReplyNeed({
      from: 'Dana <dana@x.com>', subject: 'לידיעה', snippet: 'תוכל לאשר?', commitmentLinked: false,
    })).toBe('fyi')
    expect(deterministicReplyNeed({
      from: 'Dana <dana@x.com>', subject: 'weekly', snippet: 'unsubscribe here', commitmentLinked: true,
    })).toBe('fyi')
  })

  it('counts a question, an ask, or a linked commitment', () => {
    expect(deterministicReplyNeed({
      from: 'Dana <dana@x.com>', subject: 'Q3', snippet: 'אפשר לשלוח את הקובץ', commitmentLinked: false,
    })).toBe('needs_reply')
    expect(deterministicReplyNeed({
      from: 'Dana <dana@x.com>', subject: 'הצעה', snippet: 'מצורף', commitmentLinked: true,
    })).toBe('needs_reply')
  })

  it('leaves ordinary mail for the classifier', () => {
    expect(deterministicReplyNeed({
      from: 'Dana <dana@x.com>', subject: 'סופ"ש', snippet: 'נשמע טוב נדבר', commitmentLinked: false,
    })).toBeNull()
  })
})
