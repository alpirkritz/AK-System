import { describe, expect, it } from 'vitest'
import {
  parseCalendarParticipants,
  parseDescriptionParticipants,
  participantKey,
  seriesTitleKey,
} from './calendar-participants'
import { normalizePhone, phoneFromWhatsappJid } from './phone'

describe('parseDescriptionParticipants', () => {
  it('reads the Dragontail `משתתפים:` block with names and emails', () => {
    const desc = 'Weekly sync<br>משתתפים: Dana Levi <dana@dt.com>, Yossi Cohen <yossi@dt.com>, Guest Only<br><br>agenda: roadmap'
    expect(parseDescriptionParticipants(desc)).toEqual([
      { name: 'Dana Levi', email: 'dana@dt.com' },
      { name: 'Yossi Cohen', email: 'yossi@dt.com' },
      { name: 'Guest Only', email: null },
    ])
  })

  it('returns [] when there is no participants heading', () => {
    expect(parseDescriptionParticipants('Just an agenda')).toEqual([])
    expect(parseDescriptionParticipants(null)).toEqual([])
  })
})

describe('parseCalendarParticipants', () => {
  it('drops the owner, bots and duplicates across attendees and description', () => {
    const result = parseCalendarParticipants({
      attendees: [
        { email: 'me@gmail.com', displayName: 'Me', self: true },
        { email: 'dana@dt.com', displayName: 'Dana Levi' },
        { email: 'meetingbot@teams.com' },
      ],
      description: 'משתתפים: Dana Levi <dana@dt.com>, Alpir Kritzler <alpir@dt.com>, Ron <ron@dt.com>',
      ownerEmails: ['alpir@dt.com'],
      ownerName: 'Alpir Kritzler',
    })
    expect(result).toEqual([
      { name: 'Dana Levi', email: 'dana@dt.com', source: 'attendees' },
      { name: 'Ron', email: 'ron@dt.com', source: 'description' },
    ])
  })

  it('keys by email when known, else by normalized name', () => {
    expect(participantKey({ name: 'Dana', email: 'DANA@dt.com' })).toBe('e:dana@dt.com')
    expect(participantKey({ name: '  Dana  Levi ', email: null })).toBe('n:dana levi')
  })

  it('groups titles per calendar case-insensitively', () => {
    expect(seriesTitleKey('cal1', 'Algo 4.0 Sync')).toBe(seriesTitleKey('cal1', 'algo 4.0  sync'))
    expect(seriesTitleKey('cal1', 'X')).not.toBe(seriesTitleKey('cal2', 'X'))
  })
})

describe('phone helpers', () => {
  it('normalizes Israeli local numbers to international digits', () => {
    expect(normalizePhone('050-123-4567')).toBe('972501234567')
    expect(normalizePhone('+972 50 123 4567')).toBe('972501234567')
    expect(normalizePhone('123')).toBeNull()
  })

  it('reads phones only from user JIDs', () => {
    expect(phoneFromWhatsappJid('972501234567@s.whatsapp.net')).toBe('972501234567')
    expect(phoneFromWhatsappJid('123456789012345@lid')).toBeNull()
  })
})
