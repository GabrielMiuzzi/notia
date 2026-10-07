import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronLeft, Download, Image as ImageIcon, FileCode, PanelLeft, PanelRight, Redo2, Undo2 } from 'lucide-react'
import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { useMermaidDocument } from './useMermaidDocument'
import { MermaidCodePane } from './MermaidCodePane'
import { MermaidStage, type LinkState, type StageTool } from './MermaidStage'
import { ClassElements, ErElements, IconsPane, SequenceElements, ShapesPane, StateElements } from './DockPalettes'
import { FlowchartContextMenu, FlowchartInspector } from './FlowchartPanels'
import { SequenceContextMenu, SequenceInspector } from './SequencePanels'
import { StateContextMenu, StateInspector } from './StatePanels'
import { ClassContextMenu, ClassInspector } from './ClassPanels'
import { ErContextMenu, ErInspector } from './ErPanels'
import { PathIcon } from './editorParts'
import { DIAGRAM_TYPES, engineTheme } from './diagramMeta'
import type { EditorApi } from './editorApi'
import type { DiagramKind, DiagramSelection, MermaidModel } from './mermaidEditorTypes'
import { exportDiagramPng, exportDiagramSvg } from './diagramExport'
import './mermaidEditor.css'

/*
 * Mermaid editor (canvas «Munin · Editor Mermaid»): the diagram's code and
 * palettes on the left, the drawing in the middle and the inspector of the
 * selection on the right. The backend reads the diagram and applies every
 * edit; this view shows them and sends what the person does.
 */

const VIEW_STORAGE_KEY = 'notia:mermaid-editor-view:v1'

interface ViewPreferences {
  theme: string
  grid: boolean
  handDrawn: boolean
}

function readViewPreferences(): ViewPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? '{}') as Partial<ViewPreferences>
    return { theme: stored.theme ?? 'munin', grid: stored.grid ?? true, handDrawn: stored.handDrawn ?? false }
  } catch {
    return { theme: 'munin', grid: true, handDrawn: false }
  }
}

const TOOL = {
  select: { id: 'select', label: 'Seleccionar', shortcut: 'V', icon: 'M5 3l14 7-6 2-2 6z' },
  pan: { id: 'pan', label: 'Mover lienzo', shortcut: 'H', icon: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3' },
}

function fileTitle(path: string) {
  const name = path.split(/[\\/]/).pop() ?? path
  return name.replace(/\.mmd$/i, '') || 'Diagrama'
}

function linkLabel(model: MermaidModel | null, key: string): string {
  switch (model?.kind) {
    case 'flowchart': return model.nodes.find((node) => node.id === key)?.label ?? key
    case 'sequence': return model.participants.find((participant) => participant.alias === key)?.label ?? key
    case 'state': return model.states.find((state) => state.id === key)?.label ?? key
    default: return key
  }
}

interface MermaidEditorViewProps {
  filePath: string
  source: string
  onSourcePersist: (nextSource: string) => Promise<void>
}

export const MermaidEditorView = memo(function MermaidEditorView({ filePath, source, onSourcePersist }: MermaidEditorViewProps) {
  const appTheme = useAppSelector(selectTheme)
  const doc = useMermaidDocument(source, onSourcePersist)
  const { model, selection, setSelection } = doc
  const kind: DiagramKind | null = model && 'kind' in model && ['flowchart', 'sequence', 'state', 'class', 'er'].includes(model.kind) ? (model.kind as DiagramKind) : null
  const [view, setView] = useState(readViewPreferences)
  const [tab, setTab] = useState('code')
  const [link, setLink] = useState<LinkState | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [pendingKind, setPendingKind] = useState<DiagramKind | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [panels, setPanels] = useState({ dock: false, inspector: false })
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view))
    } catch {
      // A view preference that cannot be kept only resets next time.
    }
  }, [view])

  // A selection that no longer exists goes away; the code tab is the default of another type.
  useEffect(() => {
    if (!model || !selection) return
    const exists = (() => {
      switch (model.kind) {
        case 'flowchart': return selection.kind === 'node' ? model.nodes.some((node) => node.id === selection.key) : Number(selection.key) < model.edges.length
        case 'sequence': return selection.kind === 'participant' ? model.participants.some((participant) => participant.alias === selection.key) : Number(selection.key) < model.messages.length
        case 'state': return selection.kind === 'state' ? model.states.some((state) => state.id === selection.key) : Number(selection.key) < model.transitions.length
        case 'class': return selection.kind === 'class' ? model.classes.some((node) => node.name === selection.key) : Number(selection.key) < model.relations.length
        case 'er': return selection.kind === 'entity' ? model.entities.some((entity) => entity.name === selection.key) : Number(selection.key) < model.relations.length
        default: return false
      }
    })()
    if (!exists) setSelection(null)
  }, [model, selection, setSelection])
  useEffect(() => {
    if (kind !== 'flowchart' && (tab === 'shapes' || tab === 'icons')) setTab('elements')
    if (kind === 'flowchart' && tab === 'elements') setTab('shapes')
  }, [kind, tab])

  const select = useCallback((next: DiagramSelection | null) => {
    setSelection(next)
    if (next) setPanels((current) => ({ ...current, inspector: true }))
  }, [setSelection])

  const editKind = useCallback((diagram: DiagramKind, op: string, fields: Record<string, unknown> = {}) => (
    doc.edit({ diagram, op, ...fields } as never)
  ), [doc])

  const finishLink = useCallback((to: string, before?: number) => {
    const current = link
    setLink(null)
    if (!current || !kind) return
    const from = current.from
    switch (kind) {
      case 'flowchart': void editKind(kind, 'connect', { from, to }); break
      case 'sequence': void editKind(kind, 'addMessage', { from, to, before: before ?? null }); break
      case 'state': void editKind(kind, 'addTransition', { from, to }); break
      case 'class': void editKind(kind, 'addRelation', { a: from, b: to, kind: current.extra?.kind ?? null }); break
      case 'er': void editKind(kind, 'addRelation', { a: from, b: to }); break
    }
  }, [editKind, kind, link])

  function apiFor<M>(diagramKind: DiagramKind, typed: M): EditorApi<M> {
    return {
      model: typed,
      selection,
      select,
      edit: (op, fields) => editKind(diagramKind, op, fields),
      startLink: (from, extra) => setLink({ from, extra }),
      showTab: (next) => {
        setTab(next)
        setPanels((current) => ({ ...current, dock: true }))
      },
    }
  }

  const firstOf = <T,>(values: T[]) => values[0]
  const tools: StageTool[] = useMemo(() => {
    if (!model) return []
    const add = (op: string, fields: Record<string, unknown> = {}) => () => void editKind(model.kind as DiagramKind, op, fields)
    switch (model.kind) {
      case 'flowchart': return [
        TOOL.select, TOOL.pan,
        { id: 'node', label: 'Nodo', shortcut: 'R', icon: 'M4 6h16v12H4z', run: add('addNode', { shape: 'rect' }) },
        { id: 'edge', label: 'Conector', shortcut: 'C', icon: 'M5 19L19 5M13 5h6v6' },
        { id: 'text', label: 'Texto', shortcut: 'T', icon: 'M5 6V4h14v2M12 4v16M9 20h6', run: add('addNode', { shape: 'text', label: 'Texto' }) },
      ]
      case 'sequence': return [
        TOOL.select, TOOL.pan,
        { id: 'participant', label: 'Participante', shortcut: 'P', icon: 'M3 3h18v6H3zM12 9v12', run: add('addParticipant', { kind: 'participant' }) },
        { id: 'message', label: 'Mensaje', shortcut: 'M', icon: 'M2 12h18M15 8l5 4-5 4' },
        { id: 'note', label: 'Nota', shortcut: 'N', icon: 'M4 3h12l4 4v14H4zM16 3v4h4', run: () => {
          const alias = selection?.kind === 'participant' ? selection.key : firstOf(model.participants)?.alias
          if (alias) void editKind('sequence', 'addNote', { alias })
        } },
        { id: 'block', label: 'Bloque', shortcut: 'B', icon: 'M4 4h16v16H4zM4 9h7', run: add('addBlock', { keyword: 'loop', index: selection?.kind === 'message' ? Number(selection.key) : null }) },
      ]
      case 'state': return [
        TOOL.select, TOOL.pan,
        { id: 'state', label: 'Estado', shortcut: 'S', icon: 'M5 6h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z', run: add('addState') },
        { id: 'transition', label: 'Transición', shortcut: 'T', icon: 'M5 19L19 5M13 5h6v6' },
        { id: 'startEnd', label: 'Inicio / fin', icon: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', run: () => {
          const target = selection?.kind === 'state' ? selection.key : firstOf(model.states)?.id
          if (!target) return
          const hasStart = model.transitions.some((transition) => transition.from === '[*]' && transition.to === target)
          void editKind('state', hasStart ? 'addEnd' : 'addStart', hasStart ? { from: target } : { to: target })
        } },
        { id: 'note', label: 'Nota', shortcut: 'N', icon: 'M4 3h12l4 4v14H4zM16 3v4h4', run: () => {
          const id = selection?.kind === 'state' ? selection.key : firstOf(model.states)?.id
          if (id) void editKind('state', 'addNote', { id })
        } },
      ]
      case 'class': return [
        TOOL.select, TOOL.pan,
        { id: 'class', label: 'Clase', shortcut: 'C', icon: 'M4 3h16v18H4zM4 8h16M4 14h16', run: add('addClass', { stereotype: 'none' }) },
        { id: 'relation', label: 'Relación', shortcut: 'R', icon: 'M5 19L19 5M13 5h6v6' },
      ]
      case 'er': return [
        TOOL.select, TOOL.pan,
        { id: 'entity', label: 'Entidad', shortcut: 'E', icon: 'M3 4h18v16H3zM3 9h18', run: add('addEntity') },
        { id: 'relation', label: 'Relación', shortcut: 'R', icon: 'M5 19L19 5M13 5h6v6' },
      ]
      default: return []
    }
  }, [editKind, model, selection])

  const deleteSelection = useCallback(() => {
    if (!kind || !selection) return
    const ops: Record<string, [string, Record<string, unknown>]> = {
      node: ['deleteNode', { id: selection.key }],
      edge: ['deleteEdge', { index: Number(selection.key) }],
      participant: ['deleteParticipant', { alias: selection.key }],
      message: ['deleteMessage', { index: Number(selection.key) }],
      state: ['deleteState', { id: selection.key }],
      transition: ['deleteTransition', { index: Number(selection.key) }],
      class: ['deleteClass', { name: selection.key }],
      entity: ['deleteEntity', { name: selection.key }],
      relation: ['deleteRelation', { index: Number(selection.key) }],
    }
    const [op, fields] = ops[selection.kind]
    void editKind(kind, op, fields).then((done) => done && setSelection(null))
  }, [editKind, kind, selection, setSelection])

  // Keys while the focus is in the editor (not while typing in a field).
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const typing = (event.target as HTMLElement).closest('input, textarea, select')
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault()
      doc.undo()
      return
    }
    if (modifier && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault()
      doc.redo()
      return
    }
    if (typing || modifier || event.altKey) return
    if (event.key === 'Escape') {
      setLink(null)
      setSelection(null)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
      event.preventDefault()
      deleteSelection()
    }
  }

  const switchKind = (next: DiagramKind) => {
    if (next === kind) return
    if (doc.code.trim()) {
      setPendingKind(next)
      return
    }
    void doc.edit({ diagram: 'start', kind: next })
  }

  let inspector = null
  let contextMenu = null
  let elements = null
  switch (model?.kind) {
    case 'flowchart': {
      const api = apiFor('flowchart', model)
      inspector = <FlowchartInspector api={api} />
      contextMenu = <FlowchartContextMenu key={`${selection?.kind}-${selection?.key}`} api={api} />
      elements = tab === 'icons' ? <IconsPane api={api} /> : <ShapesPane api={api} />
      break
    }
    case 'sequence': {
      const api = apiFor('sequence', model)
      inspector = <SequenceInspector api={api} />
      contextMenu = <SequenceContextMenu key={`${selection?.kind}-${selection?.key}`} api={api} />
      elements = <SequenceElements api={api} />
      break
    }
    case 'state': {
      const api = apiFor('state', model)
      inspector = <StateInspector api={api} />
      contextMenu = <StateContextMenu key={`${selection?.kind}-${selection?.key}`} api={api} />
      elements = <StateElements api={api} />
      break
    }
    case 'class': {
      const api = apiFor('class', model)
      inspector = <ClassInspector api={api} />
      contextMenu = <ClassContextMenu key={`${selection?.kind}-${selection?.key}`} api={api} />
      elements = <ClassElements api={api} />
      break
    }
    case 'er': {
      const api = apiFor('er', model)
      inspector = <ErInspector api={api} />
      contextMenu = <ErContextMenu key={`${selection?.kind}-${selection?.key}`} api={api} />
      elements = <ErElements api={api} />
      break
    }
    default:
      break
  }

  const typeMeta = DIAGRAM_TYPES.find((meta) => meta.kind === kind)
  const keyword = model?.kind === 'flowchart' ? `${model.keyword} ${model.direction}` : model?.kind === 'other' ? model.keyword : typeMeta?.keyword ?? ''
  const dockTabs = kind === 'flowchart'
    ? [{ id: 'code', label: 'Código', icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6' }, { id: 'shapes', label: 'Formas', icon: 'M4 4h8v8H4zM16 12a4 4 0 1 1 0 8 4 4 0 0 1 0-8z' }, { id: 'icons', label: 'Íconos', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01' }]
    : kind ? [{ id: 'code', label: 'Código', icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6' }, { id: 'elements', label: 'Elementos', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' }] : []

  const direction = model?.kind === 'state'
    ? { value: model.direction === 'LR' ? 'LR' : 'TB', options: [{ id: 'TB', name: 'Arriba → abajo' }, { id: 'LR', name: 'Izquierda → derecha' }], onChange: (value: string) => void editKind('state', 'setDirection', { direction: value }) }
    : model?.kind === 'class'
      ? { value: model.direction, options: ['TB', 'LR', 'BT', 'RL'].map((id) => ({ id, name: id })), onChange: (value: string) => void editKind('class', 'setDirection', { direction: value }) }
      : undefined

  const svgOf = () => rootRef.current?.querySelector('.mmd-stage-svg svg') ?? null
  const title = fileTitle(filePath)

  return (
    <div ref={rootRef} className="mmd-editor" tabIndex={-1} onKeyDown={handleKeyDown}>
      <header className="mmd-header">
        <button type="button" className="mmd-icon-button mmd-panel-toggle" aria-label="Mostrar panel izquierdo" aria-pressed={panels.dock} onClick={() => setPanels((current) => ({ dock: !current.dock, inspector: false }))}>
          <PanelLeft size={16} aria-hidden="true" />
        </button>
        <h1 title={title}>{title}</h1>
        <span className="mmd-ext">.mmd</span>
        <nav className="mmd-type-nav" aria-label="Tipo de diagrama">
          {DIAGRAM_TYPES.map((meta) => (
            <button key={meta.kind} type="button" aria-current={meta.kind === kind ? 'page' : undefined} onClick={() => switchKind(meta.kind)} title={meta.label}>
              <PathIcon d={meta.icon} size={14} />
              <span>{meta.label}</span>
            </button>
          ))}
        </nav>
        {keyword ? <span className="mmd-keyword">{keyword}</span> : null}
        <span className="mmd-header-spacer" />
        <span className="mmd-save-state" role="status">
          {doc.saved ? <><Check size={14} aria-hidden="true" />Guardado</> : 'Guardando…'}
        </span>
        <span className="mmd-header-divider" />
        <button type="button" className="mmd-icon-button" aria-label="Deshacer" title="Deshacer (Ctrl+Z)" disabled={!doc.canUndo} onClick={doc.undo}><Undo2 size={16} aria-hidden="true" /></button>
        <button type="button" className="mmd-icon-button" aria-label="Rehacer" title="Rehacer (Ctrl+Y)" disabled={!doc.canRedo} onClick={doc.redo}><Redo2 size={16} aria-hidden="true" /></button>
        <div className="mmd-menu">
          <button type="button" className="mmd-primary-button" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}>
            <Download size={15} aria-hidden="true" /><span>Exportar</span>
          </button>
          {exportOpen ? (
            <div className="mmd-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); exportDiagramPng(svgOf(), title) }}><ImageIcon size={14} aria-hidden="true" />Imagen PNG</button>
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); exportDiagramSvg(svgOf(), title) }}><FileCode size={14} aria-hidden="true" />Vector SVG</button>
            </div>
          ) : null}
        </div>
        <button type="button" className="mmd-icon-button mmd-panel-toggle" aria-label="Mostrar panel derecho" aria-pressed={panels.inspector} onClick={() => setPanels((current) => ({ inspector: !current.inspector, dock: false }))}>
          <PanelRight size={16} aria-hidden="true" />
        </button>
      </header>

      {pendingKind ? (
        <div className="mmd-banner" role="alertdialog" aria-label="Cambiar el tipo de diagrama">
          <span>¿Reemplazar este diagrama por uno nuevo de {DIAGRAM_TYPES.find((meta) => meta.kind === pendingKind)?.label.toLowerCase()}? Con Deshacer volvés al actual.</span>
          <button type="button" className="mmd-ghost-button" style={{ minHeight: 30 }} onClick={() => setPendingKind(null)}>Cancelar</button>
          <button type="button" className="mmd-primary-button" style={{ minHeight: 30 }} onClick={() => { const next = pendingKind; setPendingKind(null); setSelection(null); void doc.edit({ diagram: 'start', kind: next }) }}>Reemplazar</button>
        </div>
      ) : null}
      {doc.error ? (
        <div className="mmd-banner" data-tone="error" role="alert">
          <span>{doc.error}</span>
          <button type="button" className="mmd-icon-button" aria-label="Cerrar aviso" onClick={() => doc.setError(null)}>×</button>
        </div>
      ) : null}
      {model?.kind === 'other' ? (
        <div className="mmd-banner" role="note"><span>Este tipo de diagrama ({model.keyword}) se edita desde el código; el lienzo lo muestra.</span></div>
      ) : null}

      <div className="mmd-body">
        <section className="mmd-dock" aria-label="Panel de edición" data-open={panels.dock ? 'true' : 'false'}>
          <div className="mmd-dock-head">
            {dockTabs.length ? (
              <div className="mmd-segmented" role="tablist" aria-label="Contenido del panel">
                {dockTabs.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
                    <PathIcon d={item.icon} size={14} />{item.label}
                  </button>
                ))}
              </div>
            ) : <span className="mmd-eyebrow" style={{ flex: 1 }}>Código</span>}
            <button type="button" className="mmd-icon-button mmd-panel-toggle" aria-label="Contraer panel" onClick={() => setPanels((current) => ({ ...current, dock: false }))}>
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
          </div>
          {tab === 'code' || !elements ? (
            <MermaidCodePane
              code={doc.code}
              onChange={doc.setCode}
              model={model}
              selection={selection}
              renderError={renderError}
              direction={model?.kind === 'flowchart' ? model.direction : undefined}
              onDirection={model?.kind === 'flowchart' ? (value) => void editKind('flowchart', 'setDirection', { direction: value }) : undefined}
              onFormat={model?.kind === 'flowchart' ? () => void editKind('flowchart', 'format') : undefined}
            />
          ) : elements}
        </section>

        <MermaidStage
          code={doc.code}
          kind={kind}
          model={model}
          selection={selection}
          onSelect={select}
          tools={tools}
          link={link}
          onLinkStart={(from) => setLink({ from })}
          onLinkEnd={finishLink}
          onLinkCancel={() => setLink(null)}
          contextMenu={contextMenu}
          engineTheme={engineTheme(view.theme, appTheme)}
          theme={view.theme}
          onThemeChange={(theme) => setView((current) => ({ ...current, theme }))}
          grid={view.grid}
          onGridChange={(grid) => setView((current) => ({ ...current, grid }))}
          handDrawn={view.handDrawn}
          onHandDrawnChange={(handDrawn) => setView((current) => ({ ...current, handDrawn }))}
          direction={direction}
          onRenderError={setRenderError}
          linkLabel={link ? linkLabel(model, link.from) : ''}
          empty={(
            <>
              <strong>Diagrama vacío</strong>
              <span>Elegí un tipo arriba para empezar, o escribí el código a la izquierda.</span>
              <div className="mmd-chips">
                {DIAGRAM_TYPES.map((meta) => (
                  <button key={meta.kind} type="button" onClick={() => void doc.edit({ diagram: 'start', kind: meta.kind })}>{meta.label}</button>
                ))}
              </div>
            </>
          )}
        />

        <aside className="mmd-inspector mmd-scroll" aria-label="Propiedades" data-open={panels.inspector ? 'true' : 'false'}>
          {inspector ?? (
            <div className="mmd-section">
              <span className="mmd-subtle">Elegí un tipo de diagrama para ver sus propiedades.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
})
MermaidEditorView.displayName = 'MermaidEditorView'
