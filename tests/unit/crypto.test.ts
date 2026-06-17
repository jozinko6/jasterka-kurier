import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, maskIban, getIbanLast4, hashIp } from '@/lib/crypto-utils'

describe('crypto utilities', () => {
  describe('encrypt/decrypt', () => {
    it('round-trips a plaintext string', () => {
      const plaintext = 'SK6807200000025600987643'
      const ciphertext = encrypt(plaintext)
      expect(ciphertext).not.toBe(plaintext)
      const decrypted = decrypt(ciphertext)
      expect(decrypted).toBe(plaintext)
    })

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      const plaintext = 'test-iban-123'
      const c1 = encrypt(plaintext)
      const c2 = encrypt(plaintext)
      expect(c1).not.toBe(c2) // different IVs
      expect(decrypt(c1)).toBe(plaintext)
      expect(decrypt(c2)).toBe(plaintext)
    })
  })

  describe('maskIban', () => {
    it('masks all but the last 4 characters', () => {
      const iban = 'SK6807200000025600987643'
      const masked = maskIban(iban)
      expect(masked).toContain('643')
      expect(masked).not.toContain('680720')
      expect(masked).toContain('••••')
    })

    it('handles short input', () => {
      expect(maskIban('SK')).toBe('****')
    })

    it('removes spaces before masking', () => {
      const iban = 'SK68 0720 0000 0256 0098 7643'
      const masked = maskIban(iban)
      expect(masked).toContain('643')
    })
  })

  describe('getIbanLast4', () => {
    it('extracts last 4 characters', () => {
      expect(getIbanLast4('SK6807200000025600987643')).toBe('7643')
    })

    it('removes spaces', () => {
      expect(getIbanLast4('SK68 0720 0000 0256 0098 7643')).toBe('7643')
    })
  })

  describe('hashIp', () => {
    it('produces a consistent 16-char hex hash', () => {
      const hash = hashIp('192.168.1.1')
      expect(hash).toHaveLength(16)
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })

    it('produces the same hash for the same IP', () => {
      expect(hashIp('10.0.0.1')).toBe(hashIp('10.0.0.1'))
    })

    it('produces different hashes for different IPs', () => {
      expect(hashIp('10.0.0.1')).not.toBe(hashIp('10.0.0.2'))
    })
  })
})
