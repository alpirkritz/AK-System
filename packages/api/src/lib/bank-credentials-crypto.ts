import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * AES-256-GCM encryption for bank/credit-card credentials stored in the DB.
 * Key: BANK_CREDENTIALS_ENCRYPTION_KEY — 32 bytes, base64 (openssl rand -base64 32).
 *
 * Ciphertext layout (base64): [ciphertext][16-byte GCM auth tag].
 * The IV is stored separately (bank_connections.credentials_iv).
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const raw = process.env.BANK_CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'BANK_CREDENTIALS_ENCRYPTION_KEY is not set — generate with: openssl rand -base64 32'
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('BANK_CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (base64-encoded)')
  }
  return key
}

export function isBankCryptoConfigured(): boolean {
  const raw = process.env.BANK_CREDENTIALS_ENCRYPTION_KEY
  if (!raw) return false
  try {
    return Buffer.from(raw, 'base64').length === 32
  } catch {
    return false
  }
}

export function encryptCredentials(credentials: Record<string, string>): {
  encrypted: string
  iv: string
} {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf-8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    encrypted: Buffer.concat([ciphertext, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  }
}

export function decryptCredentials(encrypted: string, iv: string): Record<string, string> {
  const key = getKey()
  const payload = Buffer.from(encrypted, 'base64')
  if (payload.length <= AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted credentials payload')
  }
  const ciphertext = payload.subarray(0, payload.length - AUTH_TAG_LENGTH)
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf-8')) as Record<string, string>
}
