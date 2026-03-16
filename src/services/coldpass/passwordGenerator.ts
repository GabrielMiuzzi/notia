export interface ColdPassPasswordOptions {
  length: number
  includeNumbers: boolean
  includeSpecialCharacters: boolean
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const NUMBERS = '0123456789'
const SPECIAL_CHARACTERS = '!@#$%^&*()-_=+[]{};:,.<>/?'
const GUESSES_PER_SECOND = 10_000_000_000

function clampLength(length: number): number {
  return Math.max(8, Math.min(64, Math.round(length)))
}

function buildCharset(options: ColdPassPasswordOptions): string {
  let charset = LETTERS
  if (options.includeNumbers) {
    charset += NUMBERS
  }
  if (options.includeSpecialCharacters) {
    charset += SPECIAL_CHARACTERS
  }
  return charset
}

function randomIndex(maxExclusive: number): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] % maxExclusive
}

export function generateColdPassPassword(options: ColdPassPasswordOptions): string {
  const normalizedOptions: ColdPassPasswordOptions = {
    ...options,
    length: clampLength(options.length),
  }
  const charset = buildCharset(normalizedOptions)

  let password = ''
  for (let index = 0; index < normalizedOptions.length; index += 1) {
    password += charset[randomIndex(charset.length)]
  }
  return password
}

export function estimateColdPassBruteForceSeconds(options: ColdPassPasswordOptions): number {
  const normalizedLength = clampLength(options.length)
  const charsetSize = buildCharset(options).length
  return Math.pow(charsetSize, normalizedLength) / GUESSES_PER_SECOND
}

export function formatColdPassBruteForceEstimate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'Instantaneo'
  }

  const minute = 60
  const hour = minute * 60
  const day = hour * 24
  const year = day * 365
  const millionYears = year * 1_000_000
  const billionYears = year * 1_000_000_000

  if (seconds < minute) {
    return `~${Math.max(1, Math.round(seconds))} segundos`
  }
  if (seconds < hour) {
    return `~${Math.round(seconds / minute)} minutos`
  }
  if (seconds < day) {
    return `~${Math.round(seconds / hour)} horas`
  }
  if (seconds < year) {
    return `~${Math.round(seconds / day)} dias`
  }
  if (seconds < millionYears) {
    return `~${Math.round(seconds / year)} años`
  }
  if (seconds < billionYears) {
    return `~${Math.round(seconds / millionYears)} millones de años`
  }
  return `~${Math.round(seconds / billionYears)} miles de millones de años`
}
