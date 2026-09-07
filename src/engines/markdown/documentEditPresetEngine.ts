export const DOCUMENT_EDIT_PRESETS = [
  'clarity', 'grammar', 'tone', 'shorten', 'expand', 'technical', 'format', 'translate',
  'summary', 'outline', 'faq', 'table', 'checklist', 'toc',
  'extract-tasks', 'extract-dates', 'extract-decisions', 'extract-people', 'extract-risks',
  'latex', 'mermaid', 'custom',
] as const

export type DocumentEditPreset = (typeof DOCUMENT_EDIT_PRESETS)[number]

const PRESET_INSTRUCTIONS: Record<DocumentEditPreset, string> = {
  clarity: 'Mejorar claridad y orden sin cambiar el significado.',
  grammar: 'Corregir ortografía, gramática y puntuación preservando la voz.',
  tone: 'Ajustar el tono según la instrucción del usuario sin agregar hechos.',
  shorten: 'Reducir extensión eliminando redundancias y preservando información esencial.',
  expand: 'Ampliar solo con explicaciones derivadas del texto o información explícitamente solicitada.',
  technical: 'Hacer el texto más técnico y preciso sin inventar datos.',
  format: 'Reestructurar el Markdown solicitado preservando el contenido y los bloques no afectados.',
  translate: 'Traducir al idioma solicitado preservando Markdown, fórmulas, enlaces y significado.',
  summary: 'Crear un resumen fiel y acotado del bloque usando solo la evidencia disponible, sin inventar conclusiones.',
  outline: 'Crear o mejorar un esquema jerárquico de la información del bloque, preservando los datos y el orden lógico.',
  faq: 'Convertir la información del bloque en preguntas y respuestas claras; no agregar respuestas que no estén respaldadas por el texto.',
  table: 'Convertir datos comparables del bloque en una tabla Markdown con encabezados consistentes; no forzar una tabla si los datos no son tabulares.',
  checklist: 'Convertir acciones explícitas del bloque en una checklist Markdown; no transformar opiniones o hechos en tareas sin indicarlo.',
  toc: 'Crear o actualizar una tabla de contenidos Markdown basada únicamente en los headings reales del documento.',
  'extract-tasks': 'Extraer tareas accionables explícitas como checklist, conservando responsable, fecha y contexto solo cuando estén presentes.',
  'extract-dates': 'Extraer fechas y vencimientos explícitos en una lista estructurada, sin inferir fechas faltantes.',
  'extract-decisions': 'Extraer decisiones explícitas y su contexto en una lista estructurada, distinguiéndolas de propuestas o preguntas.',
  'extract-people': 'Extraer personas, roles y responsabilidades explícitamente mencionados, sin completar identidades.',
  'extract-risks': 'Extraer riesgos, bloqueos y supuestos explícitos, indicando la evidencia disponible y sin inventar severidad.',
  latex: 'Corregir o normalizar LaTeX preservando el significado matemático; no convertir fórmulas en texto plano ni inventar símbolos.',
  mermaid: 'Proponer o corregir un bloque Mermaid válido preservando los datos y sin insertar HTML, scripts, imports ni enlaces externos.',
  custom: 'Seguir la transformación específica indicada por el usuario.',
}

export function isDocumentEditPreset(value: unknown): value is DocumentEditPreset {
  return typeof value === 'string' && (DOCUMENT_EDIT_PRESETS as readonly string[]).includes(value)
}

export function documentEditPresetInstruction(value: unknown): string | null {
  return isDocumentEditPreset(value) ? PRESET_INSTRUCTIONS[value] : null
}
