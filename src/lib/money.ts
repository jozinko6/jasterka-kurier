/**
 * Money utilities.
 *
 * The canonical storage for monetary values in the database is INTEGER CENTS
 * (see Prisma schema after migration). All public-facing DTOs convert back to
 * euros on the way out. Clients therefore see `number` euros (e.g. 9.90) but
 * the server computes against integer cents (e.g. 990) to avoid float
 * rounding errors.
 *
 * During the schema migration window, the Prisma fields still expose Float
 * euros (the `*Amount`, `*Price`, `*Fee` columns). `decimalToNumber` keeps
 * those working as before. The helpers below let us normalize value flows at
 * the boundary so future schema work can swap the underlying type without
 * changing call sites.
 */

/** Convert a euro amount (number or string) to integer cents. */
export function eurosToCents(value: number | string): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot convert non-finite value to cents: ${String(value)}`)
  }
  // Round to avoid float drift: 1.005 -> 101 (banker's rounding would give 100,
  // but for typical price inputs two-decimal rounding is sufficient).
  return Math.round((n + Number.EPSILON) * 100)
}

/** Convert integer cents back to a euro number with two decimal precision. */
export function centsToEuros(cents: number | null | undefined): number {
  if (cents === null || cents === undefined) return 0
  return Math.round(cents) / 100
}

/**
 * Format a euro amount (number, string, or Prisma.Decimal) as a Slovak price
 * string, e.g. `9,90 €`. Accepts cents or euros based on the `from` argument.
 */
export function formatMoney(
  value: number | string | null | undefined,
  options: { from?: 'euros' | 'cents' } = {}
): string {
  if (value === null || value === undefined) return '0,00 €'
  const euros =
    options.from === 'cents'
      ? centsToEuros(Number(value))
      : typeof value === 'string'
        ? Number(value)
        : value
  if (!Number.isFinite(euros)) return '0,00 €'
  // Format with comma decimal separator, two digits, space before €.
  const fixed = euros.toFixed(2).replace('.', ',')
  // Insert thousands separator for values >= 1000.
  const [whole, dec] = fixed.split(',')
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${withThousands},${dec} €`
}

/**
 * Safely add two euro amounts expressed as floats. Use this whenever sums
 * must match server-side pricing exactly (avoid 0.1 + 0.2 drift). Returns a
 * euro number with two decimal precision.
 */
export function addEuros(...values: Array<number | null | undefined>): number {
  const cents = values.reduce<number>(
    (acc, v) => acc + (v === null || v === undefined ? 0 : eurosToCents(v)),
    0
  )
  return centsToEuros(cents)
}

/** Round a euro float to two decimals (defensive normalization). */
export function roundEuros(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
