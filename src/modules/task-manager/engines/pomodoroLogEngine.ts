import type { PomodoroLogEntry } from '../types/taskManagerTypes'

export interface AppendPomodoroLogEntryInput {
  timestampMs: number
  type: string
  durationChoice: string
  task: string
  durationMinutes: number
  deviationHours: number
  finalized: boolean
}

const POMODORO_LOG_HEADER = [
  '# Registro Pomodoro',
  '',
  '| fecha | horario | tipo de pomodoro | duracion elegida | tarea | tiempo | desvio | finalizacion |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
].join('\n')

export function appendPomodoroLogEntry(currentContent: string, input: AppendPomodoroLogEntryInput): string {
  const date = new Date(input.timestampMs)
  const dateText = toLocalDateText(date)
  const timeText = toLocalTimeText(date)
  const typeText = sanitizePipeText(input.type)
  const durationChoiceText = sanitizePipeText(input.durationChoice)
  const taskText = sanitizePipeText(input.task)
  const durationMinutesText = formatMinutes(input.durationMinutes)
  const deviationText = formatHours(input.deviationHours)
  const finalizedText = input.finalized ? 'true' : 'false'

  const row = `| ${dateText} | ${timeText} | ${typeText} | ${durationChoiceText} | ${taskText} | ${durationMinutesText} | ${deviationText} | ${finalizedText} |`
  const baseContent = currentContent.trim() ? currentContent : `${POMODORO_LOG_HEADER}\n`
  const suffix = baseContent.endsWith('\n') ? '' : '\n'
  return `${baseContent}${suffix}${row}\n`
}

export function readPomodoroLogEntries(content: string): PomodoroLogEntry[] {
  const entries: PomodoroLogEntry[] = []
  const lines = content.split(/\r?\n/)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line.trim().startsWith('|')) {
      continue
    }

    if (line.includes('fecha | horario | tipo de pomodoro') || line.includes('| --- |')) {
      continue
    }

    const columns = line.split('|').map((item) => item.trim()).filter(Boolean)
    if (columns.length < 5) {
      continue
    }

    const hasDurationColumns = columns.length >= 7
    const hasFinalizedColumn = columns.length >= 8
    const durationChoice = hasDurationColumns ? columns[3] : '-'
    const task = hasDurationColumns ? columns[4] : columns[3]
    const durationMinutes = hasDurationColumns ? Number.parseFloat(columns[5]) : 0
    const deviationHours = Number.parseFloat(hasDurationColumns ? columns[6] : columns[4])
    const finalizedValue = hasFinalizedColumn ? columns[7] : 'true'

    entries.push({
      id: String(lineIndex),
      date: columns[0],
      time: columns[1],
      type: columns[2],
      durationChoice,
      task,
      durationMinutes: Number.isNaN(durationMinutes) ? 0 : durationMinutes,
      deviationHours: Number.isNaN(deviationHours) ? 0 : deviationHours,
      finalized: finalizedValue.toLowerCase() !== 'false',
    })
  }

  return entries
}

export function deletePomodoroLogEntry(content: string, entryId: string): { ok: boolean; content: string } {
  const lines = content.split(/\r?\n/)
  const targetIndex = Number.parseInt(entryId, 10)

  if (Number.isNaN(targetIndex) || targetIndex < 0 || targetIndex >= lines.length) {
    return { ok: false, content }
  }

  const targetLine = lines[targetIndex] || ''
  if (!targetLine.trim().startsWith('|')) {
    return { ok: false, content }
  }

  if (targetLine.includes('fecha | horario | tipo de pomodoro') || targetLine.includes('| --- |')) {
    return { ok: false, content }
  }

  lines.splice(targetIndex, 1)
  return {
    ok: true,
    content: `${lines.join('\n').trimEnd()}\n`,
  }
}

export function getEntriesByDate(entries: PomodoroLogEntry[], localDateText: string): PomodoroLogEntry[] {
  return entries.filter((entry) => entry.date === localDateText)
}

export function toLocalDateText(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toLocalTimeText(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function sanitizePipeText(value: string): string {
  return value.replace(/\|/g, '/').trim() || '-'
}

function formatHours(hours: number): string {
  return (Math.round(hours * 100) / 100).toFixed(2)
}

function formatMinutes(minutes: number): string {
  return (Math.round(minutes * 100) / 100).toFixed(2)
}
