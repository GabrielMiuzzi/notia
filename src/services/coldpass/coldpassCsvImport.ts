import { getPathBaseName, readTextFile } from '../files/filesystemEngine'
import type { ColdPassEntry } from '../../types/coldpass'

const REQUIRED_COLDPASS_COLUMNS = [
  'name',
  'website',
  'username',
  'secondary_username',
  'password',
  'notes',
] as const

type ColdPassCsvColumn = typeof REQUIRED_COLDPASS_COLUMNS[number]

export interface ColdPassCsvImportResult {
  sourceFileName: string
  importedEntries: ColdPassEntry[]
  skippedRowCount: number
}

function normalizeCsvHeader(header: string): string {
  return header.trim().toLowerCase()
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let insideQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    const nextCharacter = content[index + 1]

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (!insideQuotes && character === ',') {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (!insideQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1
      }

      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += character
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell)
    rows.push(currentRow)
  }

  return rows
}

function resolveColumnIndexes(headerRow: string[]): Record<ColdPassCsvColumn, number> {
  const normalizedHeaders = headerRow.map(normalizeCsvHeader)
  const columnIndexes = {} as Record<ColdPassCsvColumn, number>

  for (const column of REQUIRED_COLDPASS_COLUMNS) {
    const index = normalizedHeaders.indexOf(column)
    if (index < 0) {
      throw new Error(`El CSV no contiene la columna requerida "${column}".`)
    }
    columnIndexes[column] = index
  }

  return columnIndexes
}

function readCell(row: string[], columnIndex: number): string {
  return (row[columnIndex] ?? '').trim()
}

function isEmptyImportedRow(entry: ColdPassEntry): boolean {
  return [
    entry.name,
    entry.website,
    entry.username,
    entry.secondaryUsername,
    entry.password,
    entry.notes,
  ].every((value) => !value.trim())
}

export function importColdPassEntriesFromCsvContent(
  content: string,
  sourceFileName: string,
): ColdPassCsvImportResult {
  const rows = parseCsvRows(content).filter((row) => row.some((cell) => cell.trim().length > 0))
  if (rows.length === 0) {
    return {
      sourceFileName,
      importedEntries: [],
      skippedRowCount: 0,
    }
  }

  const [headerRow, ...dataRows] = rows
  const columnIndexes = resolveColumnIndexes(headerRow)
  const importedEntries: ColdPassEntry[] = []
  let skippedRowCount = 0

  for (const row of dataRows) {
    const importedEntry: ColdPassEntry = {
      id: crypto.randomUUID(),
      name: readCell(row, columnIndexes.name),
      website: readCell(row, columnIndexes.website),
      username: readCell(row, columnIndexes.username),
      secondaryUsername: readCell(row, columnIndexes.secondary_username),
      password: readCell(row, columnIndexes.password),
      notes: readCell(row, columnIndexes.notes),
      passwordHistory: [],
    }

    if (isEmptyImportedRow(importedEntry)) {
      skippedRowCount += 1
      continue
    }

    importedEntries.push(importedEntry)
  }

  return {
    sourceFileName,
    importedEntries,
    skippedRowCount,
  }
}

export async function importColdPassEntriesFromCsvFile(filePath: string): Promise<ColdPassCsvImportResult> {
  const result = await readTextFile(filePath)
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo leer el CSV seleccionado.')
  }

  return importColdPassEntriesFromCsvContent(result.content, getPathBaseName(filePath))
}
