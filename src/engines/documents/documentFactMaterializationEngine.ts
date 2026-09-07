import type { DocumentFactCategory, ExtractedDocumentFact } from './documentFactExtractionEngine'

export interface DocumentFactEvidence {
  documentPath: string
  fact: ExtractedDocumentFact
}

const CATEGORY_LABELS: Record<DocumentFactCategory, string> = {
  tasks: 'Tareas',
  dates: 'Fechas',
  decisions: 'Decisiones',
  people: 'Personas',
  risks: 'Riesgos',
}

/** Renders only explicit candidates and keeps the source line as reviewable evidence. */
export function renderDocumentFacts(
  evidence: readonly DocumentFactEvidence[],
  title = 'Extracción de hechos',
): string {
  const safeTitle = title.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Extracción de hechos'
  const sections = (Object.keys(CATEGORY_LABELS) as DocumentFactCategory[]).flatMap((category) => {
    const items = evidence.filter((entry) => entry.fact.category === category)
    if (items.length === 0) return []
    return [
      `## ${CATEGORY_LABELS[category]}`,
      ...items.map((entry) => `- ${entry.fact.text} — evidencia: \`${entry.documentPath}:${entry.fact.line}\``),
    ]
  })
  return [`# ${safeTitle}`, '', '> Candidatos explícitos extraídos de documentos autorizados. Revisar antes de convertirlos en acciones.', '', ...sections, ''].join('\n')
}
