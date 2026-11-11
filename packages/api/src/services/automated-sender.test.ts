import { describe, expect, it } from 'vitest'
import { isAutomatedSender } from './person-resolution'

describe('isAutomatedSender', () => {
  it('flags common automated/bulk local-parts', () => {
    for (const a of [
      'no-reply@pizzahut.com',
      'noreply@x.com',
      'do-not-reply@x.com',
      'mailer-daemon@x.com',
      'postmaster@x.com',
      'bounce@x.com',
      'notifications@github.com',
      'newsletter@brand.com',
      'digest@medium.com',
      'alerts@datadog.com',
      'info@company.com',
      'support@vendor.com',
      'marketing@brand.com',
    ]) {
      expect(isAutomatedSender(a), a).toBe(true)
    }
  })

  it('flags by display name even when the address looks human', () => {
    expect(isAutomatedSender('team@acme.com', 'Acme Newsletter')).toBe(true)
    expect(isAutomatedSender('x@acme.com', 'Do Not Reply')).toBe(true)
  })

  it('treats missing or malformed addresses as automated (nothing to add)', () => {
    expect(isAutomatedSender('')).toBe(true)
    expect(isAutomatedSender(null)).toBe(true)
    expect(isAutomatedSender('not-an-address')).toBe(true)
  })

  it('lets real human senders through', () => {
    for (const a of ['dana.levi@pizzahut.com', 'alpir@dragontail.com', 'yossi@yum.com', 'r.cohen@vendor.co.il']) {
      expect(isAutomatedSender(a), a).toBe(false)
    }
  })
})
