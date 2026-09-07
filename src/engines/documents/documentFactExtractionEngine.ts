export type DocumentFactCategory = 'tasks' | 'dates' | 'decisions' | 'people' | 'risks'

export interface ExtractedDocumentFact {
  category: DocumentFactCategory
  text: string
  line: number
  confidence: 'candidate'
}

const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/
const PEOPLE_PATTERN = /(?:@([\p{L}\d][\p{L}\d._-]{1,80})|(?:responsable|asignad[oa]|participan|participantes)\s*:\s*([^\n]+))/iu

function normalizeCategories(categories: readonly DocumentFactCategory[] | undefined): Set<DocumentFactCategory> {
  return new Set(categories?.length ? categories : ['tasks', 'dates', 'decisions', 'people', 'risks'])
}

/** Extracts only explicit, reviewable candidates; it never infers facts from prose. */
export function extractDocumentFacts(
  source: string,
  categories?: readonly DocumentFactCategory[],
  maxFacts = 50,
): ExtractedDocumentFact[] {
  const selected = normalizeCategories(categories)
  const facts: ExtractedDocumentFact[] = []
  const add = (category: DocumentFactCategory, text: string, line: number) => {
    if (!selected.has(category) || facts.length >= maxFacts) return
    const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!normalized || facts.some((fact) => fact.category === category && fact.line === line && fact.text === normalized)) return
    facts.push({ category, text: normalized, line, confidence: 'candidate' })
  }

  for (const [index, rawLine] of source.replace(/\r\n/g, '\n').split('\n').entries()) {
    const line = index + 1
    const text = rawLine.trim()
    if (!text) continue
    if (/^[-*+]\s*\[[ xX]\]\s+/.test(text)) add('tasks', text, line)
    if (DATE_PATTERN.test(text)) add('dates', text, line)
    if (/\b(?:decisi[oó]n|decidimos|se acord[oó]|acordamos|resuelto|resoluci[oó]n)\b/i.test(text)) add('decisions', text, line)
    if (PEOPLE_PATTERN.test(text)) add('people', text, line)
    if (/\b(?:riesgo|riesgos|bloqueo|bloqueos|bloqueado|impedimento|impedimentos|depende de|dependencia)\b/i.test(text)) add('risks', text, line)
    if (facts.length >= maxFacts) break
  }
  return facts
}
