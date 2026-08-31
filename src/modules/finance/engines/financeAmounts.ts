export function parseFinanceCents(value: string): bigint {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new Error('Importe inválido')
  const [whole, fraction = ''] = trimmed.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
}

export function formatFinanceCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const absolute = cents < 0n ? -cents : cents
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`
}

export function sumFinanceAmounts(values: string[]): string {
  return formatFinanceCents(values.reduce((total, value) => total + parseFinanceCents(value), 0n))
}
