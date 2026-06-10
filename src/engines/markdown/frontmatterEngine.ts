export type FrontmatterScalarValue = string | number | boolean | null
export type FrontmatterValue = FrontmatterScalarValue | FrontmatterScalarValue[]

export interface FrontmatterEntry {
  key: string
  value: FrontmatterValue
}

export interface FrontmatterDocument {
  hasFrontmatter: boolean
  frontmatter: FrontmatterEntry[]
  body: string
}

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function isNumericValue(value: string): boolean {
  return /^-?(?:\d+\.?\d*|\d*\.\d+)$/.test(value)
}

function parseQuotedValue(value: string): string {
  const quote = value[0]
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) {
    return value
  }

  const inner = value.slice(1, -1)
  if (quote === '"') {
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }

  return inner.replace(/''/g, "'")
}

function parseScalarValue(rawValue: string): FrontmatterScalarValue {
  const trimmedValue = rawValue.trim()
  if (trimmedValue === '') {
    return ''
  }

  if (trimmedValue === 'null' || trimmedValue === '~') {
    return null
  }

  if (trimmedValue === 'true') {
    return true
  }

  if (trimmedValue === 'false') {
    return false
  }

  if (isNumericValue(trimmedValue)) {
    return Number(trimmedValue)
  }

  return parseQuotedValue(trimmedValue)
}

function parseInlineArray(rawValue: string): FrontmatterScalarValue[] {
  const content = rawValue.slice(1, -1).trim()
  if (!content) {
    return []
  }

  return content
    .split(',')
    .map((item) => parseScalarValue(item))
    .filter((item) => item !== null || content.includes('null'))
}

function parseValue(rawValue: string): FrontmatterValue {
  const trimmedValue = rawValue.trim()

  // Wikilinks like [[page.md]] start with '[' and end with ']', but they are
  // scalar strings, not arrays. Only parse as array when it's NOT a wikilink.
  if (
    trimmedValue.startsWith('[')
    && trimmedValue.endsWith(']')
    && !trimmedValue.startsWith('[[')
  ) {
    return parseInlineArray(trimmedValue)
  }

  return parseScalarValue(trimmedValue)
}

function isListLine(line: string): boolean {
  return /^\s*-\s+/.test(line)
}

function parseListItem(line: string): FrontmatterScalarValue {
  const match = line.match(/^\s*-\s+(.*)$/)
  if (!match) {
    return ''
  }

  return parseScalarValue(match[1])
}

function parseFrontmatterLines(lines: string[]): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line || /^\s*#/.test(line)) {
      index += 1
      continue
    }

    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/)
    if (!keyMatch) {
      index += 1
      continue
    }

    const [, key, valuePart] = keyMatch
    if (valuePart === '') {
      const listValues: FrontmatterScalarValue[] = []
      let listIndex = index + 1
      while (listIndex < lines.length && isListLine(lines[listIndex])) {
        listValues.push(parseListItem(lines[listIndex]))
        listIndex += 1
      }

      if (listValues.length > 0) {
        entries.push({ key, value: listValues })
        index = listIndex
        continue
      }

      entries.push({ key, value: '' })
      index += 1
      continue
    }

    entries.push({ key, value: parseValue(valuePart) })
    index += 1
  }

  return entries
}

function shouldQuoteString(value: string): boolean {
  if (value === '') {
    return true
  }

  if (/^\s|\s$/.test(value)) {
    return true
  }

  return /[:#{}[\],]|^[-?]|\t|\n|\r/.test(value)
}

function serializeScalarValue(value: FrontmatterScalarValue): string {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value)
  }

  if (shouldQuoteString(value)) {
    return JSON.stringify(value)
  }

  return value
}

function serializeEntry(entry: FrontmatterEntry): string[] {
  if (Array.isArray(entry.value)) {
    if (entry.value.length === 0) {
      return [`${entry.key}: []`]
    }

    return [
      `${entry.key}:`,
      ...entry.value.map((item) => `  - ${serializeScalarValue(item)}`),
    ]
  }

  return [`${entry.key}: ${serializeScalarValue(entry.value)}`]
}

export function parseFrontmatterDocument(source: string): FrontmatterDocument {
  const normalizedSource = normalizeLineBreaks(source)
  if (!normalizedSource.startsWith('---\n')) {
    return {
      hasFrontmatter: false,
      frontmatter: [],
      body: normalizedSource,
    }
  }

  const lines = normalizedSource.split('\n')
  let closingIndex = -1

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      closingIndex = index
      break
    }
  }

  if (closingIndex < 0) {
    return {
      hasFrontmatter: false,
      frontmatter: [],
      body: normalizedSource,
    }
  }

  const frontmatterLines = lines.slice(1, closingIndex)
  const bodyLines = lines.slice(closingIndex + 1)
  const body = bodyLines.join('\n').replace(/^\n+/, '')

  return {
    hasFrontmatter: true,
    frontmatter: parseFrontmatterLines(frontmatterLines),
    body,
  }
}

export function serializeFrontmatterDocument(document: FrontmatterDocument): string {
  const { frontmatter, hasFrontmatter } = document
  const normalizedBody = normalizeLineBreaks(document.body)

  if (!hasFrontmatter && frontmatter.length === 0) {
    return normalizedBody
  }

  const lines = frontmatter.flatMap(serializeEntry)

  if (normalizedBody.length === 0) {
    return `---\n${lines.join('\n')}\n---\n`
  }

  return `---\n${lines.join('\n')}\n---\n\n${normalizedBody}`
}

export function formatFrontmatterValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? 'Empty' : value.map((item) => (item === null ? 'null' : String(item))).join(', ')
  }

  if (value === '') {
    return 'Empty'
  }

  if (value === null) {
    return 'null'
  }

  return String(value)
}

export function getFrontmatterValue(entries: FrontmatterEntry[], key: string): FrontmatterValue | undefined {
  return entries.find((entry) => entry.key === key)?.value
}

export function hasFrontmatterKey(entries: FrontmatterEntry[], key: string): boolean {
  return entries.some((entry) => entry.key === key)
}

export function setFrontmatterValue(entries: FrontmatterEntry[], key: string, value: FrontmatterValue): FrontmatterEntry[] {
  const index = entries.findIndex((entry) => entry.key === key)
  if (index >= 0) {
    const nextEntries = [...entries]
    nextEntries[index] = { key, value }
    return nextEntries
  }
  return [...entries, { key, value }]
}

export function removeFrontmatterValue(entries: FrontmatterEntry[], key: string): FrontmatterEntry[] {
  return entries.filter((entry) => entry.key !== key)
}

export function ensureMarkdownDefaults(
  source: string,
  fileStats: { createdAt?: number },
): { source: string; mutated: boolean } {
  const document = parseFrontmatterDocument(source)
  let nextEntries = document.frontmatter
  let mutated = false

  if (!hasFrontmatterKey(nextEntries, 'createdAt')) {
    const createdAtValue = fileStats.createdAt ?? Date.now()
    nextEntries = setFrontmatterValue(nextEntries, 'createdAt', createdAtValue)
    mutated = true
  }

  if (!hasFrontmatterKey(nextEntries, 'nextPage')) {
    nextEntries = setFrontmatterValue(nextEntries, 'nextPage', 'N/A')
    mutated = true
  }

  if (!hasFrontmatterKey(nextEntries, 'previousPage')) {
    nextEntries = setFrontmatterValue(nextEntries, 'previousPage', 'N/A')
    mutated = true
  }

  if (!mutated) {
    return { source, mutated: false }
  }

  const nextSource = serializeFrontmatterDocument({
    hasFrontmatter: true,
    frontmatter: nextEntries,
    body: document.body,
  })

  return { source: nextSource, mutated: true }
}

export function validatePageLinkValue(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  if (value.trim() === '') {
    return false
  }
  return true
}

export function parsePropertyInputValue(input: string): FrontmatterValue {
  const normalized = input.trim()
  if (normalized === '') {
    return ''
  }

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return parseInlineArray(normalized)
  }

  return parseScalarValue(normalized)
}
