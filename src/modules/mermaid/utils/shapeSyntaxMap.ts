// Mapeo exhaustivo de alias de forma → sintaxis Mermaid nativa (flowchart v11.3.0+).
// Documentación oficial: https://mermaid.js.org/syntax/flowchart.html#node-shapes
//
// Mermaid v11.3.0+ usa la sintaxis general: id@{ shape: SHAPE_NAME }
// Si un alias no está aquí, NO es una forma nativa de Mermaid.

export const SHAPE_ALIASES: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════
  // BÁSICAS
  // ═══════════════════════════════════════════════════════════════
  text:              'text',
  rect:              'rect',
  rounded:           'rounded',
  stadium:           'stadium',
  circle:            'circle',
  'double-circle':   'double-circle',
  diamond:           'diamond',
  hexagon:           'hexagon',
  cylinder:          'cyl',
  parallelogram:     'lean-r',
  'parallelogram-alt': 'lean-l',
  trapezoid:         'trap-b',
  'inv-trapezoid':   'trap-t',
  flag:              'flag',
  triangle:          'tri',
  'small-circle':    'sm-circ',
  cloud:             'cloud',
  odd:               'odd',
  bang:              'bang',

  // ═══════════════════════════════════════════════════════════════
  // PROCESOS
  // ═══════════════════════════════════════════════════════════════
  subroutine:        'subroutine',
  database:          'cyl',
  fork:              'fork',
  collate:           'hourglass',
  'divided-process': 'div-rect',
  delay:             'delay',
  'lean-right':      'lean-r',
  'lean-left':       'lean-l',
  'mult-process':    'st-rect',
  'lin-rect':        'lin-rect',
  docs:              'docs',
  'cross-circ':      'cross-circ',
  'notch-rect':      'notch-rect',
  'brace-l':         'brace',
  'brace-r':         'brace-r',
  braces:            'braces',
  'curved-trap':     'curv-trap',

  // ═══════════════════════════════════════════════════════════════
  // TÉCNICAS
  // ═══════════════════════════════════════════════════════════════
  'h-cylinder':      'h-cyl',
  datastore:         'datastore',
  das:               'das',
  disk:              'lin-cyl',
  'lightning-bolt':  'bolt',
  'bow-rect':        'bow-rect',
  doc:               'doc',
  'lin-doc':         'lin-doc',
  'tag-doc':         'tag-doc',
  'tag-rect':        'tag-rect',
  'manual-input':    'sl-rect',
  'manual-file':     'flip-tri',
  'internal-storage': 'win-pane',
  'loop-limit':      'notch-pent',
  junction:          'f-circ',
  'stored-data':     'stored-data',
  'framed-circle':   'fr-circ',
  'framed-rectangle': 'fr-rect',
}

/**
 * Genera una línea de nodo Mermaid válida usando sintaxis nativa v11.3.0+.
 * Si el alias no está mapeado, lanza un error (no hay fallback).
 */
export function buildMermaidNodeLine(id: string, alias: string): string {
  const shapeName = SHAPE_ALIASES[alias]
  if (!shapeName) {
    throw new Error(`[shapeSyntaxMap] Alias no es una forma nativa de Mermaid: "${alias}"`)
  }
  return `  ${id}@{ shape: ${shapeName} }`
}
