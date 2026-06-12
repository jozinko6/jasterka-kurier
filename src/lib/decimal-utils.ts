import { Prisma } from '@prisma/client'

/**
 * Recursively converts all Prisma.Decimal values to plain JavaScript numbers.
 * This is needed because PostgreSQL + Prisma returns Decimal fields as
 * Prisma.Decimal objects which serialize as strings in JSON.
 */
export function decimalToNumber<T>(value: T): T {
  if (value instanceof Prisma.Decimal) {
    return (value as Prisma.Decimal).toNumber() as T
  }
  if (value === null || value === undefined) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(decimalToNumber) as T
  }
  if (typeof value === 'object' && value.constructor === Object) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = decimalToNumber((value as Record<string, unknown>)[key])
    }
    return result as T
  }
  return value
}
