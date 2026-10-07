import type {
  Activation,
  Cardinality,
  DiagramKind,
  EdgeCap,
  LineStyle,
  MessageTip,
  RelationKind,
  StateKind,
  Stereotype,
} from './mermaidEditorTypes'

/*
 * What the editor shows for each choice: Spanish names and glyphs. The
 * Mermaid syntax each choice writes is the backend's (`backend_core::mermaid`).
 */

export interface DiagramTypeMeta {
  kind: DiagramKind
  label: string
  keyword: string
  icon: string
}

export const DIAGRAM_TYPES: DiagramTypeMeta[] = [
  { kind: 'flowchart', label: 'Flujo', keyword: 'flowchart', icon: 'M5 3h6v5H5zM13 16h6v5h-6zM8 8v4h8v4' },
  { kind: 'sequence', label: 'Secuencia', keyword: 'sequenceDiagram', icon: 'M6 3v18M18 3v18M6 8h11M15 6l2 2-2 2M18 15H7M9 13l-2 2 2 2' },
  { kind: 'state', label: 'Estados', keyword: 'stateDiagram-v2', icon: 'M8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 13a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 9.5l2.5 2.5' },
  { kind: 'class', label: 'Clases', keyword: 'classDiagram', icon: 'M4 3h16v18H4zM4 8h16M4 14h16' },
  { kind: 'er', label: 'Entidad-relación', keyword: 'erDiagram', icon: 'M3 4h7v6H3zM14 14h7v6h-7zM10 7h3.5v10H14M11.5 15l2.5 2-2.5 2' },
]

export interface ShapeMeta {
  shape: string
  name: string
  category: 'basic' | 'process' | 'tech'
  /** Glyph in a 40×28 box. */
  glyph: string
}

export const SHAPES: ShapeMeta[] = [
  { shape: 'rect', name: 'Rectángulo', category: 'basic', glyph: 'M4 4h32v20H4z' },
  { shape: 'rounded', name: 'Redondeado', category: 'basic', glyph: 'M9 4h22a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5z' },
  { shape: 'stadium', name: 'Estadio', category: 'basic', glyph: 'M14 4h12a10 10 0 0 1 0 20H14a10 10 0 0 1 0-20z' },
  { shape: 'circle', name: 'Círculo', category: 'basic', glyph: 'M20 3a11 11 0 1 0 0 22 11 11 0 0 0 0-22z' },
  { shape: 'dbl-circ', name: 'Doble círculo', category: 'basic', glyph: 'M20 2a12 12 0 1 0 0 24 12 12 0 0 0 0-24zM20 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16z' },
  { shape: 'diam', name: 'Decisión', category: 'basic', glyph: 'M20 2l16 12-16 12L4 14z' },
  { shape: 'hex', name: 'Hexágono', category: 'basic', glyph: 'M11 4h18l7 10-7 10H11L4 14z' },
  { shape: 'text', name: 'Texto', category: 'basic', glyph: 'M12 8V6h16v2M20 6v16M16 22h8' },
  { shape: 'lean-r', name: 'Entrada / salida', category: 'process', glyph: 'M10 4h26l-6 20H4z' },
  { shape: 'trap-b', name: 'Manual', category: 'process', glyph: 'M10 4h20l6 20H4z' },
  { shape: 'trap-t', name: 'Prioridad', category: 'process', glyph: 'M4 4h32l-6 20H10z' },
  { shape: 'subproc', name: 'Subproceso', category: 'process', glyph: 'M4 4h32v20H4zM9 4v20M31 4v20' },
  { shape: 'doc', name: 'Documento', category: 'process', glyph: 'M4 4h32v17c-5 4-11-2-16 0s-11 4-16 0z' },
  { shape: 'odd', name: 'Asimétrico', category: 'process', glyph: 'M4 4h32v20H4l7-10z' },
  { shape: 'cyl', name: 'Base de datos', category: 'tech', glyph: 'M6 7c0-2 6-3 14-3s14 1 14 3v14c0 2-6 3-14 3S6 23 6 21zM6 7c0 2 6 3 14 3s14-1 14-3' },
  { shape: 'cloud', name: 'Nube', category: 'tech', glyph: 'M13 22a6 6 0 0 1-.6-12A8 8 0 0 1 27 9a6.5 6.5 0 0 1 1 13z' },
  { shape: 'fork', name: 'Bifurcación', category: 'tech', glyph: 'M4 12h32v4H4z' },
  { shape: 'sm-circ', name: 'Inicio', category: 'tech', glyph: 'M20 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10z' },
  { shape: 'fr-circ', name: 'Fin', category: 'tech', glyph: 'M20 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM20 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { shape: 'tri', name: 'Extracción', category: 'tech', glyph: 'M20 4l16 20H4z' },
]

export const SHAPE_CATEGORIES: Array<{ id: ShapeMeta['category']; label: string }> = [
  { id: 'basic', label: 'Básicas' },
  { id: 'process', label: 'Procesos' },
  { id: 'tech', label: 'Técnicas' },
]

export function shapeName(shape: string): string {
  if (shape === 'icon') return 'Ícono'
  if (shape === 'lean-l') return 'Entrada / salida inversa'
  return SHAPES.find((candidate) => candidate.shape === shape)?.name ?? shape
}

/** Border colors of a flowchart node (the first one is the theme's). */
export const NODE_SWATCHES = [
  { name: 'Neutro', color: '#46536F' },
  { name: 'Teal', color: '#4FD1C5' },
  { name: 'Periwinkle', color: '#6C8EFF' },
  { name: 'Ámbar', color: '#FFB86B' },
  { name: 'Coral', color: '#FF6B6B' },
  { name: 'Salvia', color: '#6FCF97' },
  { name: 'Violeta', color: '#A78BFA' },
  { name: 'Oro', color: '#D9B44A' },
]

export const STATE_SWATCHES = [
  { name: 'Slate', color: '#64748B' },
  ...NODE_SWATCHES.slice(1),
]

export const LINE_STYLES: Array<{ id: LineStyle; name: string; dash?: string; width: number; faint?: boolean }> = [
  { id: 'solid', name: 'Continua', width: 1.75 },
  { id: 'dotted', name: 'Punteada', dash: '1.5 3.5', width: 1.75 },
  { id: 'thick', name: 'Gruesa', width: 3.5 },
  { id: 'invisible', name: 'Invisible', dash: '3 3', width: 1.5, faint: true },
]

export const EDGE_CAPS: Array<{ id: EdgeCap; name: string; glyph: string }> = [
  { id: 'arrow', name: 'Flecha', glyph: 'M2 6h18M15 2l5 4-5 4' },
  { id: 'none', name: 'Sin flecha', glyph: 'M2 6h20' },
  { id: 'circle', name: 'Círculo', glyph: 'M2 6h14M16 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0' },
  { id: 'cross', name: 'Cruz', glyph: 'M2 6h14M16.5 2.5l5 7M21.5 2.5l-5 7' },
  { id: 'both', name: 'Doble flecha', glyph: 'M4 6h16M8 2L4 6l4 4M16 2l4 4-4 4' },
]

export const MESSAGE_TIPS: Array<{ id: MessageTip; name: string; glyph: string }> = [
  { id: 'arrow', name: 'Flecha', glyph: 'M2 6h18M14 2l6 4-6 4z' },
  { id: 'none', name: 'Sin punta', glyph: 'M2 6h20' },
  { id: 'async', name: 'Asíncrona', glyph: 'M2 6h18M15 2l5 4-5 4' },
  { id: 'cross', name: 'Cruz', glyph: 'M2 6h14M16.5 2.5l5 7M21.5 2.5l-5 7' },
  { id: 'both', name: 'Doble', glyph: 'M6 6h12M2 6l5-4v8zM22 6l-5-4v8z' },
]

export const ACTIVATIONS: Array<{ id: Exclude<Activation, 'none'>; name: string; suffix: string }> = [
  { id: 'activateTarget', name: 'Activar destino', suffix: '+' },
  { id: 'deactivateSource', name: 'Desactivar origen', suffix: '-' },
]

export const STATE_KINDS: Array<{ id: StateKind; name: string }> = [
  { id: 'normal', name: 'Normal' },
  { id: 'choice', name: 'Elección' },
  { id: 'fork', name: 'Fork' },
  { id: 'join', name: 'Join' },
]

export const STEREOTYPES: Array<{ id: Stereotype; name: string }> = [
  { id: 'none', name: 'Ninguno' },
  { id: 'interface', name: 'Interfaz' },
  { id: 'abstract', name: 'Abstracta' },
  { id: 'enumeration', name: 'Enum' },
]

export const RELATION_KINDS: Array<{ id: RelationKind; name: string; glyph: string; dashed: boolean }> = [
  { id: 'inheritance', name: 'Herencia', glyph: 'M10 6h12M10 2L3 6l7 4z', dashed: false },
  { id: 'realization', name: 'Realización', glyph: 'M10 6h12M10 2L3 6l7 4z', dashed: true },
  { id: 'composition', name: 'Composición', glyph: 'M11 6h11M2 6l4.5-3.5L11 6l-4.5 3.5z', dashed: false },
  { id: 'aggregation', name: 'Agregación', glyph: 'M11 6h11M2 6l4.5-3.5L11 6l-4.5 3.5z', dashed: false },
  { id: 'association', name: 'Asociación', glyph: 'M2 6h20M17 2l5 4-5 4', dashed: false },
  { id: 'dependency', name: 'Dependencia', glyph: 'M2 6h20M17 2l5 4-5 4', dashed: true },
  { id: 'link', name: 'Enlace', glyph: 'M2 6h20', dashed: false },
  { id: 'dashedLink', name: 'Enlace punteado', glyph: 'M2 6h20', dashed: true },
]

export const MULTIPLICITIES = ['1', '0..1', '0..*', '1..*', '*']

export const CARDINALITIES: Array<{ id: Cardinality; name: string; reading: string; glyph: string }> = [
  { id: 'one', name: 'Exactamente uno', reading: 'exactamente uno', glyph: 'M2 6h20M16 2v8M19 2v8' },
  { id: 'zeroOne', name: 'Cero o uno', reading: 'cero o uno', glyph: 'M2 6h11M19 2v8M13 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0' },
  { id: 'many1', name: 'Uno o más', reading: 'uno o más', glyph: 'M2 6h20M15 2v8M22 2l-5 4 5 4' },
  { id: 'many0', name: 'Cero o más', reading: 'cero o más', glyph: 'M2 6h9M22 2l-5 4 5 4M11 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0' },
]

export const VISIBILITY_NAMES: Record<string, string> = { '+': 'público', '-': 'privado', '#': 'protegido', '~': 'de paquete', '': 'sin visibilidad' }

export const DIRECTIONS = ['TD', 'LR', 'BT', 'RL']

export const THEMES = [
  { id: 'munin', name: 'Munin' },
  { id: 'dark', name: 'Oscuro' },
  { id: 'default', name: 'Claro' },
  { id: 'neutral', name: 'Neutral' },
  { id: 'forest', name: 'Bosque' },
]

/** The theme the render engine takes for an editor theme. */
export function engineTheme(theme: string, appTheme: string): string {
  if (theme === 'dark' || theme === 'default' || theme === 'neutral' || theme === 'forest') return `mermaid-${theme}`
  return appTheme === 'light' ? 'light' : 'dark'
}
