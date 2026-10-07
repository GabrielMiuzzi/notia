import { useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Copy, CopyPlus, MoreHorizontal, Plus, Shapes, Trash2, Type } from 'lucide-react'
import { CommitInput, EmptyInspector, Field, Glyph, InspectorHeader, Section, Segmented, Swatches, SyntaxBox } from './editorParts'
import { EDGE_CAPS, LINE_STYLES, NODE_SWATCHES, shapeName, SHAPES } from './diagramMeta'
import { selectionIs, type EditorApi } from './editorApi'
import type { FillMode, FlowchartModel, FlowEdge, FlowNode, TextSize } from './mermaidEditorTypes'

/* Flowchart: inspector and floating menus (canvas board «Flujo»). */

const FILLS: Array<{ id: FillMode; name: string }> = [
  { id: 'surface', name: 'Superficie' },
  { id: 'tint', name: 'Tinte' },
  { id: 'none', name: 'Ninguno' },
]
const SIZES: Array<{ id: TextSize; name: string }> = [
  { id: 'S', name: 'Chico' },
  { id: 'M', name: 'Medio' },
  { id: 'L', name: 'Grande' },
]

function nodeLabel(model: FlowchartModel, id: string) {
  return model.nodes.find((node) => node.id === id)?.label ?? id
}

function edgeSyntax(model: FlowchartModel, edge: FlowEdge) {
  const label = edge.label && edge.lineStyle !== 'invisible' ? `|${edge.label}|` : ''
  return `${nodeLabel(model, edge.from)} ${edge.op}${label} ${nodeLabel(model, edge.to)}`
}

function shapeGlyph(shape: string) {
  return SHAPES.find((candidate) => candidate.shape === shape)?.glyph ?? 'M4 4h32v20H4z'
}

function NodeInspector({ api, node }: { api: EditorApi<FlowchartModel>; node: FlowNode }) {
  const style = (change: Partial<{ border: string | undefined; fill: FillMode; textSize: TextSize }>) => {
    const next = { border: node.border, fill: node.fill, textSize: node.textSize, ...change }
    void api.edit('setNodeStyle', { id: node.id, border: next.border ?? null, fill: next.fill, textSize: next.textSize })
  }
  const border = NODE_SWATCHES.find((swatch) => swatch.color.toUpperCase() === node.border?.toUpperCase()) ?? NODE_SWATCHES[0]
  const incoming = api.model.edges.filter((edge) => edge.to === node.id)
  const outgoing = api.model.edges.filter((edge) => edge.from === node.id)
  return (
    <>
      <Section>
        <div className="mmd-title-row">
          <span className="mmd-title-badge"><Glyph d={shapeGlyph(node.shape)} width={40} height={28} strokeWidth={2.5} /></span>
          <strong>{node.label}</strong>
        </div>
        <div className="mmd-id-row">
          <span>id: {node.id}</span>
          <button type="button" className="mmd-icon-button" style={{ width: 22, height: 22 }} aria-label="Copiar id" onClick={() => void navigator.clipboard.writeText(node.id)}>
            <Copy size={12} aria-hidden="true" />
          </button>
        </div>
      </Section>
      <Section>
        <Field label="Etiqueta">
          <CommitInput value={node.label} label="Etiqueta del nodo" onCommit={(label) => void api.edit('setNodeLabel', { id: node.id, label })} />
        </Field>
        <Field label="Forma">
          <button type="button" className="mmd-row-button" onClick={() => api.showTab('shapes')}>
            <span>{node.icon ? `Ícono · ${node.icon}` : shapeName(node.shape)}</span>
            <small className="mmd-mono">{node.shape}</small>
            <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--color-muted-text)' }} />
          </button>
        </Field>
      </Section>
      <Section title="Estilo">
        <Field label={<>Borde · <strong>{border.name}</strong></>}>
          <Swatches swatches={NODE_SWATCHES} value={node.border} onChange={(color) => style({ border: color })} />
        </Field>
        <Field label="Relleno">
          <Segmented label="Relleno" options={FILLS} value={node.fill} onChange={(fill) => style({ fill })} />
        </Field>
        <Field label="Tamaño del texto">
          <Segmented label="Tamaño del texto" options={SIZES} value={node.textSize} onChange={(textSize) => style({ textSize })} />
        </Field>
      </Section>
      <Section title="Conexiones">
        {[...incoming.map((edge) => ({ edge, incoming: true })), ...outgoing.map((edge) => ({ edge, incoming: false }))].map(({ edge, incoming: from }) => (
          <button key={edge.index} type="button" className="mmd-row-button" onClick={() => api.select({ kind: 'edge', key: String(edge.index) })}>
            {from ? <ArrowLeft size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}
            <span className="mmd-subtle">{from ? 'desde' : 'hacia'}</span>
            <span>{nodeLabel(api.model, from ? edge.from : edge.to)}</span>
            <small>{edge.label}</small>
          </button>
        ))}
        <button type="button" className="mmd-dashed-button" onClick={() => api.startLink(node.id)}>
          <Plus size={14} aria-hidden="true" />Conectar a otro nodo
        </button>
      </Section>
      <Section>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="mmd-ghost-button" style={{ flex: 1 }} onClick={() => void api.edit('duplicateNode', { id: node.id })}>
            <CopyPlus size={14} aria-hidden="true" />Duplicar
          </button>
          <button type="button" className="mmd-danger-button" style={{ flex: 1 }} onClick={() => void api.edit('deleteNode', { id: node.id }).then((done) => done && api.select(null))}>
            <Trash2 size={14} aria-hidden="true" />Eliminar
          </button>
        </div>
      </Section>
    </>
  )
}

function LineOptions({ edge, api, compact = false }: { edge: FlowEdge; api: EditorApi<FlowchartModel>; compact?: boolean }) {
  return (
    <>
      {LINE_STYLES.map((line) => (
        <button
          key={line.id}
          type="button"
          className={compact ? 'mmd-icon-button' : 'mmd-card'}
          style={compact ? { width: 34 } : { justifyContent: 'flex-start', gap: 10 }}
          aria-pressed={edge.lineStyle === line.id}
          aria-label={line.name}
          title={line.name}
          onClick={() => void api.edit('setEdgeLine', { index: edge.index, lineStyle: line.id })}
        >
          <svg width={compact ? 22 : 30} height="12" viewBox={`0 0 ${compact ? 22 : 30} 12`} aria-hidden="true">
            <path d={`M2 6h${compact ? 18 : 26}`} style={{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: line.width, strokeDasharray: line.dash, opacity: line.faint ? 0.45 : 1 }} />
          </svg>
          {compact ? null : <span>{line.name}</span>}
        </button>
      ))}
    </>
  )
}

function EdgeInspector({ api, edge }: { api: EditorApi<FlowchartModel>; edge: FlowEdge }) {
  const invisible = edge.lineStyle === 'invisible'
  const cap = EDGE_CAPS.find((candidate) => candidate.id === edge.cap) ?? EDGE_CAPS[0]
  return (
    <>
      <Section>
        <div className="mmd-chip-row">
          <button type="button" className="mmd-chip" onClick={() => api.select({ kind: 'node', key: edge.from })}>{nodeLabel(api.model, edge.from)}</button>
          <ArrowRight size={14} aria-hidden="true" style={{ color: 'var(--color-muted-text)', flexShrink: 0 }} />
          <button type="button" className="mmd-chip" onClick={() => api.select({ kind: 'node', key: edge.to })}>{nodeLabel(api.model, edge.to)}</button>
        </div>
        <span className="mmd-subtle">Conexión · línea {edge.line + 1} del código</span>
      </Section>
      <Section>
        <Field label="Texto">
          <CommitInput value={edge.label} label="Texto de la conexión" placeholder="Sin texto" onCommit={(label) => void api.edit('setEdgeLabel', { index: edge.index, label })} />
        </Field>
        <Field label="Línea">
          <div className="mmd-cards"><LineOptions edge={edge} api={api} /></div>
        </Field>
        <Field label={<>Extremo · <strong>{invisible ? 'no aplica en línea invisible' : cap.name}</strong></>}>
          <div className="mmd-cards mmd-cards--five">
            {EDGE_CAPS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="mmd-card"
                aria-pressed={!invisible && edge.cap === option.id}
                aria-label={option.name}
                title={option.name}
                disabled={invisible}
                onClick={() => void api.edit('setEdgeCap', { index: edge.index, cap: option.id })}
              >
                <Glyph d={option.glyph} width={26} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Sintaxis"><SyntaxBox text={edgeSyntax(api.model, edge)} /></Field>
      </Section>
      <Section>
        <button type="button" className="mmd-ghost-button" onClick={() => void api.edit('swapEdge', { index: edge.index })}>Invertir sentido</button>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteEdge', { index: edge.index }).then((done) => done && api.select(null))}>
          <Trash2 size={14} aria-hidden="true" />Eliminar conexión
        </button>
      </Section>
    </>
  )
}

export function FlowchartInspector({ api }: { api: EditorApi<FlowchartModel> }) {
  const nodeId = selectionIs(api.selection, 'node')
  const edgeIndex = selectionIs(api.selection, 'edge')
  const node = nodeId ? api.model.nodes.find((candidate) => candidate.id === nodeId) : undefined
  const edge = edgeIndex !== null ? api.model.edges[Number(edgeIndex)] : undefined
  return (
    <>
      <InspectorHeader title={edge ? 'Conexión' : node ? 'Nodo' : 'Propiedades'} onClear={node || edge ? () => api.select(null) : undefined} />
      {node ? <NodeInspector key={node.id} api={api} node={node} />
        : edge ? <EdgeInspector key={edge.index} api={api} edge={edge} />
          : (
            <EmptyInspector
              text="Hacé clic en un nodo o en una conexión para editar su texto y su estilo."
              counts={[{ label: 'Nodos', value: api.model.nodes.length }, { label: 'Conexiones', value: api.model.edges.length }]}
            />
          )}
    </>
  )
}

/** The floating menu over the selected node or link. */
export function FlowchartContextMenu({ api }: { api: EditorApi<FlowchartModel> }) {
  const [open, setOpen] = useState<'color' | 'cap' | 'more' | 'text' | null>(null)
  const nodeId = selectionIs(api.selection, 'node')
  const edgeIndex = selectionIs(api.selection, 'edge')
  const node = nodeId ? api.model.nodes.find((candidate) => candidate.id === nodeId) : undefined
  const edge = edgeIndex !== null ? api.model.edges[Number(edgeIndex)] : undefined
  if (node && open === 'text') {
    return (
      <CommitInput
        value={node.label}
        label="Texto del nodo"
        onCommit={(label) => {
          setOpen(null)
          void api.edit('setNodeLabel', { id: node.id, label })
        }}
      />
    )
  }
  if (node) {
    const border = NODE_SWATCHES.find((swatch) => swatch.color.toUpperCase() === node.border?.toUpperCase()) ?? NODE_SWATCHES[0]
    return (
      <>
        <button type="button" className="mmd-icon-button" aria-label="Cambiar forma" title="Forma" onClick={() => api.showTab('shapes')}><Shapes size={15} aria-hidden="true" /></button>
        <div className="mmd-menu">
          <button type="button" className="mmd-icon-button" aria-label="Color" title="Color" aria-expanded={open === 'color'} onClick={() => setOpen(open === 'color' ? null : 'color')}>
            <span className="mmd-swatch" style={{ background: border.color }} />
          </button>
          {open === 'color' ? (
            <div className="mmd-menu-list" role="menu" style={{ minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(4, 28px)', gap: 6, padding: 8 }}>
              {NODE_SWATCHES.map((swatch) => (
                <button
                  key={swatch.color}
                  type="button"
                  role="menuitemradio"
                  aria-checked={swatch.color === border.color}
                  aria-label={swatch.name}
                  style={{ width: 28, minHeight: 28, padding: 0, background: swatch.color, border: swatch.color === border.color ? '2px solid var(--color-heading-text)' : '2px solid transparent' }}
                  onClick={() => {
                    setOpen(null)
                    void api.edit('setNodeStyle', { id: node.id, border: swatch.color, fill: node.fill, textSize: node.textSize })
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="mmd-icon-button" aria-label="Texto" title="Texto" onClick={() => setOpen('text')}><Type size={15} aria-hidden="true" /></button>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-context-text" onClick={() => api.startLink(node.id)}><ArrowRight size={15} aria-hidden="true" />Conectar</button>
        <div className="mmd-menu">
          <button type="button" className="mmd-icon-button" aria-label="Más acciones" title="Más" aria-expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}>
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
          {open === 'more' ? (
            <div className="mmd-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('duplicateNode', { id: node.id }) }}><CopyPlus size={14} aria-hidden="true" />Duplicar</button>
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('deleteNode', { id: node.id }).then((done) => done && api.select(null)) }}><Trash2 size={14} aria-hidden="true" />Eliminar</button>
            </div>
          ) : null}
        </div>
      </>
    )
  }
  if (edge) {
    const invisible = edge.lineStyle === 'invisible'
    const cap = EDGE_CAPS.find((candidate) => candidate.id === edge.cap) ?? EDGE_CAPS[0]
    return (
      <>
        <CommitInput value={edge.label} label="Texto de la conexión" placeholder="Agregar texto…" onCommit={(label) => void api.edit('setEdgeLabel', { index: edge.index, label })} />
        <span className="mmd-bar-divider" />
        <LineOptions edge={edge} api={api} compact />
        <span className="mmd-bar-divider" />
        <div className="mmd-menu">
          <button type="button" className="mmd-context-text" disabled={invisible} aria-haspopup="menu" aria-expanded={open === 'cap'} aria-label={`Extremo: ${cap.name}`} title="Extremo" onClick={() => setOpen(open === 'cap' ? null : 'cap')}>
            <Glyph d={cap.glyph} /><ChevronDown size={12} aria-hidden="true" />
          </button>
          {open === 'cap' && !invisible ? (
            <div className="mmd-menu-list" role="menu" aria-label="Extremo de la conexión">
              {EDGE_CAPS.map((option) => (
                <button key={option.id} type="button" role="menuitemradio" aria-checked={edge.cap === option.id} onClick={() => { setOpen(null); void api.edit('setEdgeCap', { index: edge.index, cap: option.id }) }}>
                  <Glyph d={option.glyph} />{option.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-icon-button" data-danger="true" aria-label="Eliminar conexión" title="Eliminar" onClick={() => void api.edit('deleteEdge', { index: edge.index }).then((done) => done && api.select(null))}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </>
    )
  }
  return null
}
