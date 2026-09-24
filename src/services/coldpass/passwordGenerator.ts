export interface ColdPassPasswordOptions {
  length: number
  includeNumbers: boolean
  includeSpecialCharacters: boolean
}

/*
 * The backend generates the password and estimates its strength
 * (`coldpass_generate_password`); this module formats the estimate.
 */

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
