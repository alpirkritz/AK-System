import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { people } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { applyMatchedPhones, describePeopleApiError, includeInPhoneSync } from './google-phone-fill'
import {
  matchGooglePhones,
  pickGooglePhone,
  type GooglePhoneContact,
  type PhonePerson,
} from './google-phone-match'

const NOW = new Date().toISOString()

function person(partial: Partial<PhonePerson> & Pick<PhonePerson, 'id' | 'name'>): PhonePerson {
  return { email: null, phone: null, status: 'confirmed', ...partial }
}

function contact(partial: Partial<GooglePhoneContact> & Pick<GooglePhoneContact, 'resourceName' | 'phone'>): GooglePhoneContact {
  return { displayName: partial.resourceName, emails: [], ...partial }
}

describe('includeInPhoneSync', () => {
  it('skips the DAZ Google account and keeps the personal one', () => {
    expect(includeInPhoneSync('alpir@daz.guru')).toBe(false)
    expect(includeInPhoneSync('Alpir@DAZ.guru')).toBe(false)
    expect(includeInPhoneSync('alpirkritz@gmail.com')).toBe(true)
  })
})

describe('describePeopleApiError', () => {
  it('tells the owner to enable People API instead of reconnecting', () => {
    const body = 'People API has not been used in project 185057895621 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/people.googleapis.com/overview?project=185057895621 then retry.'
    expect(describePeopleApiError(403, body)).toContain('People API כבוי')
    expect(describePeopleApiError(403, body)).toContain('project=185057895621')
  })

  it('asks to reconnect when the token lacks the contacts scope', () => {
    expect(describePeopleApiError(403, 'Request had insufficient authentication scopes.')).toContain('חבר מחדש')
  })
})

describe('matchGooglePhones', () => {
  it('fills an empty phone from a unique email', () => {
    const { proposals, skipped, unmatched } = matchGooglePhones(
      [person({ id: 'p1', name: 'דנה לוי', email: 'dana@dt.com' })],
      [contact({ resourceName: 'c1', displayName: 'Dana', emails: ['dana@dt.com'], phone: '+972501234567' })],
    )
    expect(proposals).toEqual([
      { personId: 'p1', personName: 'דנה לוי', phone: '+972501234567', googleName: 'Dana', matchedBy: 'email' },
    ])
    expect(skipped).toEqual([])
    expect(unmatched).toBe(0)
  })

  it('uses a unique name when there is no email match', () => {
    const { proposals } = matchGooglePhones(
      [person({ id: 'p1', name: 'דנה  לוי' })],
      [contact({ resourceName: 'c1', displayName: 'דנה לוי', phone: '050-111-2233' })],
    )
    expect(proposals[0]).toMatchObject({ personId: 'p1', matchedBy: 'name' })
  })

  it('skips a name shared by two people and does not invent a person', () => {
    const { proposals, skipped, unmatched } = matchGooglePhones(
      [person({ id: 'p1', name: 'יוסי כהן' }), person({ id: 'p2', name: 'יוסי כהן' })],
      [contact({ resourceName: 'c1', displayName: 'יוסי כהן', phone: '0501112233' }), contact({ resourceName: 'c2', displayName: 'אין כזה', phone: '0509998877' })],
    )
    expect(proposals).toEqual([])
    expect(skipped.map((s) => s.reason)).toEqual(['ambiguous_name'])
    expect(unmatched).toBe(1)
  })

  it('skips an email shared by two people', () => {
    const { proposals, skipped } = matchGooglePhones(
      [
        person({ id: 'p1', name: 'א', email: 'same@dt.com' }),
        person({ id: 'p2', name: 'ב', email: 'same@dt.com' }),
      ],
      [contact({ resourceName: 'c1', emails: ['same@dt.com'], phone: '0501112233' })],
    )
    expect(proposals).toEqual([])
    expect(skipped[0]?.reason).toBe('ambiguous_email')
  })

  it('does not overwrite someone who already has a phone, and does not reuse that contact as a name match', () => {
    const { proposals } = matchGooglePhones(
      [
        person({ id: 'p1', name: 'דנה לוי', email: 'dana@dt.com', phone: '050-000-0000' }),
        person({ id: 'p2', name: 'Dana' }),
      ],
      [contact({ resourceName: 'c1', displayName: 'Dana', emails: ['dana@dt.com'], phone: '+972501111111' })],
    )
    expect(proposals).toEqual([])
  })

  it('ignores ignored people', () => {
    const { proposals, unmatched } = matchGooglePhones(
      [person({ id: 'p1', name: 'דנה לוי', status: 'ignored', email: 'dana@dt.com' })],
      [contact({ resourceName: 'c1', displayName: 'דנה לוי', emails: ['dana@dt.com'], phone: '0501112233' })],
    )
    expect(proposals).toEqual([])
    expect(unmatched).toBe(0)
  })

  it('drops a person when two contacts disagree on the phone', () => {
    const { proposals, skipped } = matchGooglePhones(
      [person({ id: 'p1', name: 'דנה לוי', email: 'dana@dt.com' })],
      [
        contact({ resourceName: 'c1', emails: ['dana@dt.com'], phone: '+972501111111' }),
        contact({ resourceName: 'c2', emails: ['dana@dt.com'], phone: '+972502222222' }),
      ],
    )
    expect(proposals).toEqual([])
    expect(skipped.some((s) => s.reason === 'conflicting_phones')).toBe(true)
  })

  it('keeps an email match when another contact only shares the name', () => {
    const { proposals } = matchGooglePhones(
      [person({ id: 'p1', name: 'דנה לוי', email: 'dana@dt.com' })],
      [
        contact({ resourceName: 'c1', displayName: 'Dana L', emails: ['dana@dt.com'], phone: '+972501111111' }),
        contact({ resourceName: 'c2', displayName: 'דנה לוי', phone: '+972502222222' }),
      ],
    )
    expect(proposals).toEqual([
      { personId: 'p1', personName: 'דנה לוי', phone: '+972501111111', googleName: 'Dana L', matchedBy: 'email' },
    ])
  })

  it('drops a name match when two contacts disagree on the phone', () => {
    const { proposals, skipped } = matchGooglePhones(
      [person({ id: 'p1', name: 'דנה לוי' })],
      [
        contact({ resourceName: 'c1', displayName: 'דנה לוי', phone: '+972501111111' }),
        contact({ resourceName: 'c2', displayName: 'דנה לוי', phone: '+972502222222' }),
      ],
    )
    expect(proposals).toEqual([])
    expect(skipped.some((s) => s.reason === 'conflicting_phones')).toBe(true)
  })

  it('keeps one proposal when both contacts have the same phone', () => {
    const { proposals } = matchGooglePhones(
      [person({ id: 'p1', name: 'דנה לוי', email: 'dana@dt.com' })],
      [
        contact({ resourceName: 'c1', emails: ['dana@dt.com'], phone: '050-111-2233' }),
        contact({ resourceName: 'c2', emails: ['dana@dt.com'], phone: '+972501112233' }),
      ],
    )
    expect(proposals).toHaveLength(1)
  })

  it('prefers a mobile number', () => {
    expect(pickGooglePhone([
      { value: '03-1111111', type: 'work' },
      { value: '050-111-2233', type: 'mobile' },
    ])).toBe('050-111-2233')
  })
})

describe('applyMatchedPhones', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('writes a blank phone and leaves an existing phone alone', async () => {
    const db = getTestDb()
    await db.insert(people).values([
      { id: 'p1', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: NOW },
      { id: 'p2', name: 'רון', phone: '050-000-0000', status: 'confirmed', source: 'manual', createdAt: NOW },
    ])
    const result = await applyMatchedPhones(db, [
      { personId: 'p1', name: 'Dana Levi' },
      { personId: 'p2', name: 'Ron' },
      { personId: 'missing', name: 'Nobody' },
    ], [
      { personId: 'p1', personName: 'דנה', phone: '+972501112233', googleName: 'Dana Levi', matchedBy: 'email' },
      { personId: 'p2', personName: 'רון', phone: '+972509999999', googleName: 'Ron', matchedBy: 'name' },
    ])
    expect(result).toEqual({ updated: 1, skipped: 1 })
    const rows = await db.select({
      id: people.id,
      name: people.name,
      phone: people.phone,
      capture: people.captureWhatsapp,
    }).from(people)
    expect(rows).toHaveLength(2)
    const dana = rows.find((r) => r.id === 'p1')
    expect(dana?.phone).toBe('+972501112233')
    expect(dana?.name).toBe('Dana Levi')
    expect(dana?.capture).toBe(true)
    const ron = rows.find((r) => r.id === 'p2')
    expect(ron?.phone).toBe('050-000-0000')
    expect(ron?.name).toBe('רון')
    expect(ron?.capture).toBe(false)
  })

  it('falls back to the phone-book name when the edit is blank', async () => {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p1', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: NOW })
    await applyMatchedPhones(
      db,
      [{ personId: 'p1', name: '   ' }],
      [{ personId: 'p1', personName: 'דנה', phone: '+972501112233', googleName: 'Dana', matchedBy: 'email' }],
    )
    const [row] = await db.select({ name: people.name, capture: people.captureWhatsapp }).from(people).where(eq(people.id, 'p1'))
    expect(row?.name).toBe('Dana')
    expect(row?.capture).toBe(true)
  })

  it('rejects a blank person id and treats an empty selection as a no-op', async () => {
    const caller = await createTestCaller()
    await expect(caller.contacts.applyGooglePhones({ fills: [{ personId: '', name: 'Dana' }] })).rejects.toThrow()
    await expect(caller.contacts.applyGooglePhones({ fills: [] })).resolves.toEqual({
      updated: 0,
      skipped: 0,
      errors: [],
    })
  })

  it('does not write a phone for an id the preview did not propose', async () => {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p1', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: NOW })
    await applyMatchedPhones(db, [{ personId: 'p1', name: 'Dana' }], [])
    const [row] = await db.select({ phone: people.phone, name: people.name, capture: people.captureWhatsapp }).from(people).where(eq(people.id, 'p1'))
    expect(row?.phone).toBeNull()
    expect(row?.name).toBe('דנה')
    expect(row?.capture).toBe(false)
  })
})
