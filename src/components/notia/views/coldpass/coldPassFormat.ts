import type { ColdPassEntryView, ColdPassHealth } from '../../../../types/coldpass'

/** Labels of the password health the backend decides. */
export const HEALTH_LABELS: Record<ColdPassHealth, string> = {
  strong: 'Fuerte',
  weak: 'Débil',
  old: 'Antigua',
}

/** What a hidden password shows. */
export const MASK = '••••••••••••'

/** Previous passwords shown before «Ver las N anteriores». */
export const HISTORY_PREVIEW = 3

export type HealthFilter = 'all' | 'weak' | 'old'

export const HEALTH_FILTERS: { id: HealthFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'weak', label: 'Débiles' },
  { id: 'old', label: 'Antiguas' },
]

/** The letter of a credential's tile. */
export function credentialInitial(entry: ColdPassEntryView): string {
  return (entry.name.trim() || entry.website.trim() || '?').charAt(0).toUpperCase()
}

/** «1 anterior», «7 anteriores». */
export function historyCount(count: number): string {
  return count === 1 ? '1 anterior' : `${count} anteriores`
}

/** The button that shows the rest of the history or folds it back. */
export function historyToggleLabel(isOpen: boolean, count: number): string {
  return isOpen ? `Mostrar solo las ${HISTORY_PREVIEW} más recientes` : `Ver las ${count - HISTORY_PREVIEW} anteriores`
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DAY_MS = 24 * 60 * 60 * 1000
const relative = new Intl.RelativeTimeFormat('es', { numeric: 'always' })

/** «hace 3 días», «hace 14 meses», «hace 2 años» or «hoy». */
export function formatAgo(timestamp: number, now: number): string {
  const days = Math.floor((now - timestamp) / DAY_MS)
  if (days < 1) return 'hoy'
  if (days < 30) return relative.format(-days, 'day')
  const months = Math.floor(days / 30.4375)
  if (months < 24) return relative.format(-Math.max(months, 1), 'month')
  return relative.format(-Math.floor(days / 365), 'year')
}

/** «Cambiada hace 14 meses», or that the date is unknown. */
export function formatChanged(timestamp: number | null | undefined, now: number): string {
  return typeof timestamp === 'number' ? `Cambiada ${formatAgo(timestamp, now)}` : 'Sin fecha de cambio'
}

/** «Reemplazada el 25 sep 2026». */
export function formatReplaced(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number') return 'Reemplazada, sin fecha'
  const date = new Date(timestamp)
  return `Reemplazada el ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** The site as it reads, without the scheme or a trailing slash. */
export function displaySite(website: string): string {
  return website.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/** A web address for the site, or `null` when it is not one. */
export function siteHref(website: string): string | null {
  const site = website.trim()
  if (!site || /\s/.test(site)) return null
  if (/^https?:\/\//i.test(site)) return site
  if (!/^[\w.-]+(:\d+)?(\/.*)?$/.test(site) || !site.includes('.')) return null
  return `${/^\d/.test(site) ? 'http' : 'https'}://${site}`
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * «6 credenciales en el vault, 1 débil y 2 para rotar»; the phone board
 * (`short`) leaves out «en el vault».
 */
export function vaultSummary(entries: ColdPassEntryView[], { short = false }: { short?: boolean } = {}): string {
  if (entries.length === 0) return 'Todavía no hay credenciales en el vault'
  const weak = entries.filter((entry) => entry.health === 'weak').length
  const old = entries.filter((entry) => entry.health === 'old').length
  const issues = [
    weak > 0 ? plural(weak, 'débil', 'débiles') : null,
    old > 0 ? `${old} para rotar` : null,
  ].filter(Boolean)
  const count = plural(entries.length, 'credencial', 'credenciales')
  const base = short ? count : `${count} en el vault`
  return issues.length > 0 ? `${base}, ${issues.join(' y ')}` : base
}

/** Whether `entry` matches the search, over the fields the list shows. */
export function matchesSearch(entry: ColdPassEntryView, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [entry.name, entry.website, entry.username, entry.secondaryUsername, entry.notes]
    .some((value) => value.toLowerCase().includes(normalized))
}

/** «8f95d4ef…8e4b61». */
export function shortUuid(uuid: string): string {
  return uuid.length > 16 ? `${uuid.slice(0, 8)}…${uuid.slice(-6)}` : uuid
}
