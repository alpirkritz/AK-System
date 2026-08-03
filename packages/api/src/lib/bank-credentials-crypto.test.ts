import { describe, it, expect, beforeEach } from 'vitest'
import { randomBytes } from 'crypto'
import {
  encryptCredentials,
  decryptCredentials,
  isBankCryptoConfigured,
} from './bank-credentials-crypto'

describe('bank-credentials-crypto', () => {
  beforeEach(() => {
    process.env.BANK_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })

  it('round-trips a credential object', () => {
    const credentials = { userCode: 'AB1234', password: 'p@ssw0rd עברית' }
    const { encrypted, iv } = encryptCredentials(credentials)
    expect(encrypted).not.toContain('p@ssw0rd')
    expect(decryptCredentials(encrypted, iv)).toEqual(credentials)
  })

  it('produces a different ciphertext + IV per call (fresh IV)', () => {
    const credentials = { username: 'user', password: 'secret' }
    const a = encryptCredentials(credentials)
    const b = encryptCredentials(credentials)
    expect(a.encrypted).not.toBe(b.encrypted)
    expect(a.iv).not.toBe(b.iv)
  })

  it('fails to decrypt with a tampered ciphertext (GCM auth)', () => {
    const { encrypted, iv } = encryptCredentials({ password: 'secret' })
    const bytes = Buffer.from(encrypted, 'base64')
    bytes[0] = bytes[0] ^ 0xff
    expect(() => decryptCredentials(bytes.toString('base64'), iv)).toThrow()
  })

  it('fails to decrypt with the wrong key', () => {
    const { encrypted, iv } = encryptCredentials({ password: 'secret' })
    process.env.BANK_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(() => decryptCredentials(encrypted, iv)).toThrow()
  })

  it('throws a clear error when the key is missing or malformed', () => {
    delete process.env.BANK_CREDENTIALS_ENCRYPTION_KEY
    expect(() => encryptCredentials({ a: 'b' })).toThrow(/BANK_CREDENTIALS_ENCRYPTION_KEY/)
    expect(isBankCryptoConfigured()).toBe(false)

    process.env.BANK_CREDENTIALS_ENCRYPTION_KEY = Buffer.from('short').toString('base64')
    expect(() => encryptCredentials({ a: 'b' })).toThrow(/32 bytes/)
    expect(isBankCryptoConfigured()).toBe(false)

    process.env.BANK_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(isBankCryptoConfigured()).toBe(true)
  })
})
