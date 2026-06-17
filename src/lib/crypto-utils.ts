/**
 * AES-256-GCM encryption for sensitive fields like IBAN.
 *
 * The encryption key is read from the ENCRYPTION_KEY environment variable
 * (32-byte hex string). In development, a deterministic fallback key is used
 * so the app boots without configuration — but production MUST set
 * ENCRYPTION_KEY to a random 32-byte hex value.
 *
 * Only the last 4 characters of the IBAN are stored in plaintext for UI
 * display. The full IBAN is stored as an AES-256-GCM ciphertext (base64).
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM standard IV length

function getKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY
  if (envKey) {
    // Accept hex or base64
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      return Buffer.from(envKey, 'hex')
    }
    const decoded = Buffer.from(envKey, 'base64')
    if (decoded.length === 32) return decoded
  }
  // Development fallback — deterministic but NOT secure. Only for local dev.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be set in production (32-byte hex or base64)')
  }
  return crypto.scryptSync('jasterka-dev-key', 'salt', 32)
}

export interface EncryptedValue {
  ciphertext: string // base64
}

/** Encrypt a plaintext string using AES-256-GCM. Returns base64 ciphertext. */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv(12) || tag(16) || ciphertext, all base64
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/** Decrypt a base64 ciphertext produced by `encrypt`. */
export function decrypt(b64: string): string {
  const key = getKey()
  const data = Buffer.from(b64, 'base64')
  const iv = data.subarray(0, IV_LENGTH)
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = data.subarray(IV_LENGTH + 16)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

/** Mask an IBAN for display, showing only the last 4 characters. */
export function maskIban(iban: string): string {
  const cleaned = iban.replace(/\s/g, '')
  if (cleaned.length < 4) return '****'
  const last4 = cleaned.slice(-4)
  return `•••• •••• •••• ${last4}`
}

/** Extract the last 4 characters of an IBAN for storage in plaintext. */
export function getIbanLast4(iban: string): string {
  const cleaned = iban.replace(/\s/g, '')
  return cleaned.slice(-4)
}

/** Hash an IP address for audit logging (SHA-256, truncated). */
export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16)
}
