import type { ColdPassEntry } from '../../types/coldpass'

const COLUMN_KEYS = [
  'name',
  'website',
  'username',
  'secondary_username',
  'password',
  'notes',
] as const

const METADATA_START_MARKER = '<!-- NOTIA_COLDPASS_METADATA'
const METADATA_END_MARKER = 'NOTIA_COLDPASS_METADATA -->'

interface ColdPassMetadataEntry {
  id: string
  passwordHistory?: string[]
}

interface ColdPassMetadataPayload {
  entries?: ColdPassMetadataEntry[]
}

function createColdPassEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `coldpass-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function unescapeMarkdownCell(value: string): string {
  return value.replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim()
}

function splitMarkdownRow(row: string): string[] {
  const cells: string[] = []
  let current = ''
  let isEscaped = false

  for (const character of row.trim()) {
    if (isEscaped) {
      current += character
      isEscaped = false
      continue
    }

    if (character === '\\') {
      current += character
      isEscaped = true
      continue
    }

    if (character === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += character
  }

  cells.push(current.trim())
  return cells.filter((_, index, list) => !(index === 0 && list[0] === '') && !(index === list.length - 1 && list.at(-1) === ''))
}

export function createEmptyColdPassMarkdown(): string {
  return [
    '| name | website | username | secondary_username | password | notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ].join('\n')
}

function extractColdPassMetadata(markdown: string): ColdPassMetadataPayload {
  const startIndex = markdown.indexOf(METADATA_START_MARKER)
  const endIndex = markdown.indexOf(METADATA_END_MARKER)
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return {}
  }

  const rawMetadata = markdown
    .slice(startIndex + METADATA_START_MARKER.length, endIndex)
    .trim()
  if (!rawMetadata) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawMetadata)
    return parsed && typeof parsed === 'object' ? parsed as ColdPassMetadataPayload : {}
  } catch {
    return {}
  }
}

export function parseColdPassMarkdown(markdown: string): ColdPassEntry[] {
  const metadata = extractColdPassMetadata(markdown)
  const metadataEntries = Array.isArray(metadata.entries) ? metadata.entries : []
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headerIndex = lines.findIndex((line) => line.startsWith('|') && line.includes('secondary_username'))
  if (headerIndex < 0 || headerIndex + 1 >= lines.length) {
    return []
  }

  const dataLines = lines.slice(headerIndex + 2).filter((line) => line.startsWith('|'))
  return dataLines.map((line, index) => {
    const cells = splitMarkdownRow(line)
    const metadataEntry = metadataEntries[index]
    return {
      id: typeof metadataEntry?.id === 'string' && metadataEntry.id.trim()
        ? metadataEntry.id
        : createColdPassEntryId(),
      name: unescapeMarkdownCell(cells[0] ?? ''),
      website: unescapeMarkdownCell(cells[1] ?? ''),
      username: unescapeMarkdownCell(cells[2] ?? ''),
      secondaryUsername: unescapeMarkdownCell(cells[3] ?? ''),
      password: unescapeMarkdownCell(cells[4] ?? ''),
      notes: unescapeMarkdownCell(cells[5] ?? ''),
      passwordHistory: Array.isArray(metadataEntry?.passwordHistory)
        ? metadataEntry.passwordHistory.filter((value): value is string => typeof value === 'string')
        : [],
    }
  })
}

export function stringifyColdPassMarkdown(entries: ColdPassEntry[]): string {
  const header = createEmptyColdPassMarkdown()
  if (entries.length === 0) {
    return header
  }

  const rows = entries.map((entry) => [
    entry.name,
    entry.website,
    entry.username,
    entry.secondaryUsername,
    entry.password,
    entry.notes,
  ])

  const markdownRows = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`)
  const metadataPayload: ColdPassMetadataPayload = {
    entries: entries.map((entry) => ({
      id: entry.id,
      passwordHistory: entry.passwordHistory,
    })),
  }
  const metadataBlock = [
    METADATA_START_MARKER,
    JSON.stringify(metadataPayload, null, 2),
    METADATA_END_MARKER,
  ].join('\n')

  return [header, ...markdownRows, '', metadataBlock].join('\n')
}

export { COLUMN_KEYS as COLDPASS_MARKDOWN_COLUMNS }
