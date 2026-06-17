import { describe, it, expect } from 'vitest'
import {
  eurosToCents,
  centsToEuros,
  formatMoney,
  addEuros,
  roundEuros,
} from '@/lib/money'

describe('money utilities', () => {
  describe('eurosToCents', () => {
    it('converts simple euro amounts to cents', () => {
      expect(eurosToCents(1)).toBe(100)
      expect(eurosToCents(0.5)).toBe(50)
      expect(eurosToCents(9.9)).toBe(990)
    })

    it('handles string input', () => {
      expect(eurosToCents('10.50')).toBe(1050)
      expect(eurosToCents('0.01')).toBe(1)
    })

    it('rounds correctly to avoid float drift', () => {
      expect(eurosToCents(0.1 + 0.2)).toBe(30) // not 30.000000000000004
      expect(eurosToCents(19.99)).toBe(1999)
    })

    it('throws on non-finite values', () => {
      expect(() => eurosToCents(NaN)).toThrow()
      expect(() => eurosToCents(Infinity)).toThrow()
    })
  })

  describe('centsToEuros', () => {
    it('converts cents to euros', () => {
      expect(centsToEuros(100)).toBe(1)
      expect(centsToEuros(990)).toBe(9.9)
      expect(centsToEuros(1)).toBe(0.01)
    })

    it('handles null/undefined', () => {
      expect(centsToEuros(null)).toBe(0)
      expect(centsToEuros(undefined)).toBe(0)
    })
  })

  describe('formatMoney', () => {
    it('formats euros with Slovak format', () => {
      expect(formatMoney(9.9)).toBe('9,90 €')
      expect(formatMoney(1000)).toBe('1 000,00 €')
    })

    it('handles cents input', () => {
      expect(formatMoney(990, { from: 'cents' })).toBe('9,90 €')
    })

    it('handles null', () => {
      expect(formatMoney(null)).toBe('0,00 €')
    })
  })

  describe('addEuros', () => {
    it('adds euros without float drift', () => {
      expect(addEuros(0.1, 0.2)).toBe(0.3)
      expect(addEuros(1.5, 2.5, 3.0)).toBe(7)
    })

    it('handles nulls', () => {
      expect(addEuros(1, null, 2)).toBe(3)
    })
  })

  describe('roundEuros', () => {
    it('rounds to two decimals', () => {
      expect(roundEuros(1.005)).toBe(1.01)
      expect(roundEuros(1.234)).toBe(1.23)
    })
  })
})
