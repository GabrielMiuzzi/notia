import type { FrontmatterEntry, FrontmatterValue } from '../../../../../engines/markdown/frontmatterEngine'

/** How a property is shown and edited. It is read from the key and the value; frontmatter has no types. */
export type PropertyKind = 'context' | 'noteLink' | 'timestamp' | 'date' | 'checkbox' | 'number' | 'tags' | 'text'

/** Types offered by «Agregar propiedad», with the value a new property starts with. */
export const NEW_PROPERTY_TYPES: ReadonlyArray<{ kind: PropertyKind; label: string; glyph: string; initialValue: () => FrontmatterValue }> = [
  { kind: 'text', label: 'Texto', glyph: 'Aa', initialValue: () => '' },
  { kind: 'tags', label: 'Etiquetas', glyph: '#', initialValue: () => [] },
  { kind: 'number', label: 'Número', glyph: '12', initialValue: () => 0 },
  { kind: 'date', label: 'Fecha', glyph: '◷', initialValue: () => toDateInputValue(new Date()) },
  { kind: 'noteLink', label: 'Nota', glyph: '→', initialValue: () => '' },
  { kind: 'checkbox', label: 'Casilla', glyph: '☐', initialValue: () => false },
]

/** Keys every note carries; they cannot be deleted. */
const PROTECTED_KEYS = new Set(['createdat', 'nextpage', 'previouspage'])
const PAGE_LINK_KEYS = new Set(['nextpage', 'previouspage'])
/** Value Rust writes for a page link that points nowhere. */
export const EMPTY_PAGE_LINK = 'N/A'
const PROPERTY_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/
const SINGLE_WIKI_LINK_PATTERN = /^\[\[[^[\]]+\]\]$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** Epoch values below this are seconds, above it milliseconds. */
const EPOCH_MILLISECONDS_THRESHOLD = 100_000_000_000

/** Fixed short months: WebViews disagree on `Intl` («sep», «sept.», «de sept de»). */
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function isPageLinkKey(key: string): boolean {
  return PAGE_LINK_KEYS.has(key.toLowerCase())
}

export function isProtectedKey(key: string): boolean {
  return PROTECTED_KEYS.has(key.toLowerCase())
}

export function isContextKey(key: string): boolean {
  return key.toLowerCase() === 'contexto'
}

export function inferPropertyKind(entry: FrontmatterEntry): PropertyKind {
  const { key, value } = entry
  if (isContextKey(key)) return 'context'
  if (isPageLinkKey(key)) return 'noteLink'
  if (typeof value === 'boolean') return 'checkbox'
  if (Array.isArray(value)) return 'tags'
  if (typeof value === 'number') return /At$/.test(key) || key.toLowerCase() === 'createdat' ? 'timestamp' : 'number'
  if (typeof value === 'string' && SINGLE_WIKI_LINK_PATTERN.test(value.trim())) return 'noteLink'
  if (typeof value === 'string' && DATE_PATTERN.test(value.trim())) return 'date'
  return 'text'
}

/** Error for a new key, or `null` when it can be added. */
export function validatePropertyKey(key: string, existingKeys: ReadonlySet<string>): string | null {
  if (!key) return 'Escribí un nombre.'
  if (!PROPERTY_KEY_PATTERN.test(key)) return 'Usá letras, números, - o _, empezando con una letra.'
  if (existingKeys.has(key.toLowerCase())) return 'Ya hay una propiedad con ese nombre.'
  return null
}

export function isEmptyNoteLink(value: FrontmatterValue): boolean {
  return typeof value !== 'string' || value.trim() === '' || value.trim() === EMPTY_PAGE_LINK
}

/** `[[Nota]]` from the text someone typed, or `null` when it is empty. */
export function toWikiLinkValue(reference: string): string | null {
  const inner = reference.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
  return inner ? `[[${inner}]]` : null
}

export function stripWikiLink(value: string): string {
  return value.trim().replace(/^\[\[/, '').replace(/\]\]$/, '')
}

function toDate(value: FrontmatterValue): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < EPOCH_MILLISECONDS_THRESHOLD ? value * 1000 : value)
  }
  if (typeof value === 'string' && DATE_PATTERN.test(value.trim())) {
    const [year, month, day] = value.trim().split('-').map(Number)
    return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
  }
  return null
}

function validDate(value: FrontmatterValue): Date | null {
  const date = toDate(value)
  return date && !Number.isNaN(date.getTime()) ? date : null
}

/** «19 sep 2026» */
export function formatPropertyDate(value: FrontmatterValue): string | null {
  const date = validDate(value)
  return date ? `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}` : null
}

/** «19 sep 2026, 01:43» */
export function formatPropertyDateTime(value: FrontmatterValue): string | null {
  const date = validDate(value)
  if (!date) return null
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${formatPropertyDate(value)}, ${time}`
}

export function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Context tag without its `#`, as the chips show it. */
export function contextLabel(value: FrontmatterValue): string {
  return typeof value === 'string' ? value.replace(/^#/, '') : ''
}

/** What the collapsed panel shows: the context and the creation date. */
export function summarizeProperties(entries: readonly FrontmatterEntry[]): { context: string | null; date: string | null } {
  const context = entries.find((entry) => isContextKey(entry.key))
  const createdAt = entries.find((entry) => entry.key.toLowerCase() === 'createdat')
  return {
    context: context ? contextLabel(context.value) || null : null,
    date: createdAt ? formatPropertyDate(createdAt.value) : null,
  }
}
