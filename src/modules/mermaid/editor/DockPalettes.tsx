import { useEffect, useMemo, useState } from 'react'
import { Icon, addCollection } from '@iconify/react'
import type { IconifyJSON } from '@iconify/types'
import { Search } from 'lucide-react'
import { Glyph } from './editorParts'
import { CARDINALITIES, RELATION_KINDS, SHAPE_CATEGORIES, SHAPES } from './diagramMeta'
import { selectionIs, type EditorApi } from './editorApi'
import type { ClassModel, ErModel, FlowchartModel, SequenceModel, StateModel } from './mermaidEditorTypes'

/* The dock's palettes: shapes and icons of a flowchart, and the elements of the other types. */

export function ShapesPane({ api }: { api: EditorApi<FlowchartModel> }) {
  const [category, setCategory] = useState<'basic' | 'process' | 'tech'>('basic')
  const nodeId = selectionIs(api.selection, 'node')
  const node = nodeId ? api.model.nodes.find((candidate) => candidate.id === nodeId) : undefined
  return (
    <div className="mmd-pane">
      <div className="mmd-tabs-line" role="tablist" aria-label="Categorías de formas">
        {SHAPE_CATEGORIES.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="mmd-tiles mmd-scroll">
        {SHAPES.filter((shape) => shape.category === category).map((shape) => (
          <button
            key={shape.shape}
            type="button"
            className="mmd-tile"
            aria-pressed={node ? node.shape === shape.shape : undefined}
            aria-label={shape.name}
            onClick={() => void (node ? api.edit('setNodeShape', { id: node.id, shape: shape.shape }) : api.edit('addNode', { shape: shape.shape }))}
          >
            <Glyph d={shape.glyph} width={44} height={30} strokeWidth={1.5} />
            <span>{shape.name}</span>
            <small>{shape.shape}</small>
          </button>
        ))}
      </div>
      <p className="mmd-pane-foot">{node ? `Tocá una forma para aplicarla a «${node.label}».` : 'Tocá una forma para agregar un nodo nuevo; con un nodo seleccionado, le cambia la forma.'}</p>
    </div>
  )
}

interface PackDef {
  prefix: string
  set: 'fa' | 'gcp' | 'si'
  loader: () => Promise<IconifyJSON | null>
}

const PACKS: PackDef[] = [
  { prefix: 'fa', set: 'fa', loader: () => import('@iconify-json/fa').then((module) => module.icons as IconifyJSON).catch(() => null) },
  { prefix: 'fa-solid', set: 'fa', loader: () => import('@iconify-json/fa-solid').then((module) => module.icons as IconifyJSON).catch(() => null) },
  { prefix: 'fa-brands', set: 'fa', loader: () => import('@iconify-json/fa-brands').then((module) => module.icons as IconifyJSON).catch(() => null) },
  { prefix: 'gcp', set: 'gcp', loader: () => import('@iconify-json/gcp').then((module) => module.icons as IconifyJSON).catch(() => null) },
  { prefix: 'simple-icons', set: 'si', loader: () => import('@iconify-json/simple-icons').then((module) => module.icons as IconifyJSON).catch(() => null) },
]
const SETS: Array<{ id: 'all' | PackDef['set']; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'fa', label: 'Font Awesome' },
  { id: 'gcp', label: 'Google Cloud' },
  { id: 'si', label: 'Simple Icons' },
]
const PAGE = 96

export function IconsPane({ api }: { api: EditorApi<FlowchartModel> }) {
  const [query, setQuery] = useState('')
  const [set, setSet] = useState<'all' | PackDef['set']>('all')
  const [icons, setIcons] = useState<Array<{ ref: string; set: PackDef['set'] }> | null>(null)
  const [visible, setVisible] = useState(PAGE)
  const nodeId = selectionIs(api.selection, 'node')

  useEffect(() => {
    let current = true
    void Promise.all(PACKS.map(async (pack) => ({ pack, icons: await pack.loader() }))).then((loaded) => {
      if (!current) return
      const all: Array<{ ref: string; set: PackDef['set'] }> = []
      for (const { pack, icons: collection } of loaded) {
        if (!collection) continue
        addCollection(collection)
        for (const name of Object.keys(collection.icons)) all.push({ ref: `${pack.prefix}:${name}`, set: pack.set })
      }
      setIcons(all)
    })
    return () => { current = false }
  }, [])

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase()
    return (icons ?? []).filter((icon) => (set === 'all' || icon.set === set) && (!words || icon.ref.includes(words)))
  }, [icons, query, set])

  return (
    <div className="mmd-pane">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px 10px', borderBottom: '1px solid var(--color-border-soft)' }}>
        <label className="mmd-search">
          <span className="mmd-sr">Buscar ícono</span>
          <Search size={15} aria-hidden="true" />
          <input className="mmd-input" value={query} placeholder="Buscar ícono…" onChange={(event) => { setQuery(event.target.value); setVisible(PAGE) }} />
        </label>
        <div className="mmd-chips">
          {SETS.map((item) => (
            <button key={item.id} type="button" aria-pressed={set === item.id} onClick={() => { setSet(item.id); setVisible(PAGE) }}>{item.label}</button>
          ))}
        </div>
      </div>
      <div
        className="mmd-icon-grid mmd-scroll"
        style={{ flex: 1, minHeight: 0, alignContent: 'start' }}
        onScroll={(event) => {
          const target = event.currentTarget
          if (target.scrollTop + target.clientHeight > target.scrollHeight - 200) setVisible((count) => count + PAGE)
        }}
      >
        {icons === null ? <p className="mmd-subtle" style={{ gridColumn: '1 / -1' }}>Cargando íconos…</p> : null}
        {icons && filtered.length === 0 ? <p className="mmd-subtle" style={{ gridColumn: '1 / -1', textAlign: 'center' }}>No hay íconos que coincidan con «{query}».</p> : null}
        {filtered.slice(0, visible).map((icon) => (
          <button
            key={icon.ref}
            type="button"
            title={icon.ref}
            aria-label={icon.ref}
            onClick={() => void (nodeId ? api.edit('setNodeIcon', { id: nodeId, icon: icon.ref }) : api.edit('addNode', { shape: 'icon', icon: icon.ref }))}
          >
            <Icon icon={icon.ref} width={20} height={20} />
            <small>{icon.ref.split(':')[1]}</small>
          </button>
        ))}
      </div>
      <p className="mmd-pane-foot">El ícono se agrega como nodo nuevo, o dentro del nodo seleccionado.</p>
    </div>
  )
}

interface Tile {
  name: string
  hint: string
  glyph: string
  onClick: () => void
  disabled?: boolean
  dash?: string
}

function TileGroup({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <>
      <h3 className="mmd-eyebrow mmd-group-title">{title}</h3>
      {tiles.map((tile) => (
        <button key={tile.name} type="button" className="mmd-tile" style={{ minHeight: 76 }} disabled={tile.disabled} onClick={tile.onClick}>
          <Glyph d={tile.glyph} width={26} height={14} dash={tile.dash} />
          <span>{tile.name}</span>
          <small>{tile.hint}</small>
        </button>
      ))}
    </>
  )
}

function ElementsFrame({ children, foot }: { children: React.ReactNode; foot: string }) {
  return (
    <div className="mmd-pane">
      <div className="mmd-tiles mmd-tiles--two mmd-scroll" style={{ flex: 1, minHeight: 0, alignContent: 'start' }}>{children}</div>
      <p className="mmd-pane-foot">{foot}</p>
    </div>
  )
}

const BOX = 'M3 3h18v6H3zM3 15h18v6H3z'
const LINE = 'M2 6h18M15 2l5 4-5 4'
const NOTE = 'M4 3h12l4 4v10H4zM16 3v4h4'

export function SequenceElements({ api }: { api: EditorApi<SequenceModel> }) {
  const { participants, messages } = api.model
  const selectedAlias = selectionIs(api.selection, 'participant')
  const selectedMessage = selectionIs(api.selection, 'message')
  const first = participants[0]?.alias
  const second = participants[1]?.alias ?? first
  const message = (lineStyle: string, tip: string) => () => void api.edit('addMessage', { from: selectedAlias ?? first, to: selectedAlias && selectedAlias !== first ? first : second, lineStyle, tip })
  const block = (keyword: string) => () => void api.edit('addBlock', { keyword, index: selectedMessage !== null ? Number(selectedMessage) : null })
  return (
    <ElementsFrame foot="Los mensajes van entre los dos primeros participantes (o desde el seleccionado); un bloque envuelve el mensaje seleccionado.">
      <div className="mmd-switch-card">
        <div><strong>Numerar mensajes</strong><small>autonumber</small></div>
        <button type="button" role="switch" className="mmd-switch" aria-checked={api.model.autonumber} aria-label="Numerar mensajes" onClick={() => void api.edit('setAutonumber', { enabled: !api.model.autonumber })}><span /></button>
      </div>
      <TileGroup
        title="Participantes"
        tiles={[
          { name: 'Participante', hint: 'participant', glyph: BOX, onClick: () => void api.edit('addParticipant', { kind: 'participant' }) },
          { name: 'Actor', hint: 'actor', glyph: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 7v6M8 9h8M12 13l-3 6M12 13l3 6', onClick: () => void api.edit('addParticipant', { kind: 'actor' }) },
        ]}
      />
      <TileGroup
        title="Mensajes"
        tiles={[
          { name: 'Síncrono', hint: 'A->>B', glyph: LINE, onClick: message('solid', 'arrow'), disabled: !first },
          { name: 'Respuesta', hint: 'B-->>A', glyph: LINE, dash: '3 3', onClick: message('dotted', 'arrow'), disabled: !first },
          { name: 'Asíncrono', hint: 'A-)B', glyph: 'M2 6h18M15 2l5 4-5 4', onClick: message('solid', 'async'), disabled: !first },
          { name: 'Fallido', hint: 'A-xB', glyph: 'M2 6h14M16.5 2.5l5 7M21.5 2.5l-5 7', onClick: message('solid', 'cross'), disabled: !first },
        ]}
      />
      <TileGroup
        title="Bloques"
        tiles={[
          { name: 'Bucle', hint: 'loop', glyph: 'M4 4h16v16H4z', onClick: block('loop') },
          { name: 'Alternativa', hint: 'alt / else', glyph: 'M4 4h16v16H4zM4 12h16', onClick: block('alt') },
          { name: 'Opcional', hint: 'opt', glyph: 'M4 4h16v16H4z', onClick: block('opt') },
          { name: 'Paralelo', hint: 'par / and', glyph: 'M4 4h16v16H4zM4 12h16', onClick: block('par') },
          { name: 'Crítico', hint: 'critical', glyph: 'M4 4h16v16H4z', onClick: block('critical') },
          { name: 'Fondo', hint: 'rect rgb()', glyph: 'M4 4h16v16H4z', onClick: block('rect') },
        ]}
      />
      <TileGroup
        title="Anotaciones"
        tiles={[
          { name: 'Nota', hint: 'Note right of', glyph: NOTE, onClick: () => void api.edit('addNote', { alias: selectedAlias ?? first }), disabled: !first },
          { name: 'Activación', hint: 'activate', glyph: 'M10 3h4v18h-4z', onClick: () => void api.edit('activateParticipant', { alias: selectedAlias ?? second }), disabled: messages.length < 2 },
        ]}
      />
    </ElementsFrame>
  )
}

export function StateElements({ api }: { api: EditorApi<StateModel> }) {
  const selected = selectionIs(api.selection, 'state')
  const first = api.model.states[0]?.id
  const last = api.model.states.at(-1)?.id
  return (
    <ElementsFrame foot="Inicio y fin se enlazan con el estado seleccionado (o con el primero y el último); la transición empieza en el seleccionado.">
      <TileGroup
        title="Estados"
        tiles={[
          { name: 'Estado', hint: 'state "…" as id', glyph: 'M5 6h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z', onClick: () => void api.edit('addState', {}) },
          { name: 'Elección', hint: '<<choice>>', glyph: 'M12 3l9 9-9 9-9-9z', onClick: () => void api.edit('addState', { label: 'Elección', kind: 'choice' }) },
          { name: 'Fork', hint: '<<fork>>', glyph: 'M3 10h18v4H3z', onClick: () => void api.edit('addState', { label: 'Fork', kind: 'fork' }) },
          { name: 'Join', hint: '<<join>>', glyph: 'M3 10h18v4H3z', onClick: () => void api.edit('addState', { label: 'Join', kind: 'join' }) },
        ]}
      />
      <TileGroup
        title="Pseudoestados"
        tiles={[
          { name: 'Inicio', hint: '[*] --> id', glyph: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', onClick: () => void api.edit('addStart', { to: selected ?? first }), disabled: !first },
          { name: 'Fin', hint: 'id --> [*]', glyph: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', onClick: () => void api.edit('addEnd', { from: selected ?? last }), disabled: !last },
        ]}
      />
      <TileGroup
        title="Conexiones y notas"
        tiles={[
          { name: 'Transición', hint: 'a --> b : evento', glyph: LINE, onClick: () => selected && api.startLink(selected), disabled: !selected },
          { name: 'Nota', hint: 'note right of', glyph: NOTE, onClick: () => void api.edit('addNote', { id: selected ?? first }), disabled: !first },
        ]}
      />
    </ElementsFrame>
  )
}

export function ClassElements({ api }: { api: EditorApi<ClassModel> }) {
  const selected = selectionIs(api.selection, 'class')
  return (
    <ElementsFrame foot="Las relaciones empiezan en la clase seleccionada: tocá el tipo y después la otra clase.">
      <TileGroup
        title="Clases"
        tiles={[
          { name: 'Clase', hint: 'class Nombre', glyph: 'M4 3h16v18H4zM4 8h16M4 14h16', onClick: () => void api.edit('addClass', { stereotype: 'none' }) },
          { name: 'Interfaz', hint: '<<interface>>', glyph: 'M4 3h16v18H4zM4 8h16', onClick: () => void api.edit('addClass', { stereotype: 'interface' }) },
          { name: 'Abstracta', hint: '<<abstract>>', glyph: 'M4 3h16v18H4zM4 8h16', onClick: () => void api.edit('addClass', { stereotype: 'abstract' }) },
          { name: 'Enumeración', hint: '<<enumeration>>', glyph: 'M4 3h16v18H4zM8 10h8M8 14h8M8 18h8', onClick: () => void api.edit('addClass', { stereotype: 'enumeration' }) },
        ]}
      />
      <TileGroup
        title="Relaciones"
        tiles={RELATION_KINDS.map((kind) => ({
          name: kind.name,
          hint: kind.dashed ? 'punteada' : 'continua',
          glyph: kind.glyph,
          dash: kind.dashed ? '3 3' : undefined,
          disabled: !selected,
          onClick: () => selected && api.startLink(selected, { kind: kind.id }),
        }))}
      />
    </ElementsFrame>
  )
}

export function ErElements({ api }: { api: EditorApi<ErModel> }) {
  const selectedEntity = selectionIs(api.selection, 'entity')
  const selectedRelation = selectionIs(api.selection, 'relation')
  const first = api.model.entities[0]?.name
  const relationIndex = selectedRelation !== null ? Number(selectedRelation) : null
  return (
    <ElementsFrame foot="Con una relación seleccionada, la cardinalidad se aplica al segundo lado y el tipo de relación a la línea.">
      <TileGroup
        title="Entidades"
        tiles={[
          { name: 'Entidad', hint: 'NOMBRE { }', glyph: 'M3 4h18v16H3zM3 9h18', onClick: () => void api.edit('addEntity') },
          { name: 'Atributo', hint: 'tipo nombre PK', glyph: 'M4 8h16M4 12h10M4 16h12', onClick: () => void api.edit('addAttribute', { name: selectedEntity ?? first }), disabled: !first },
        ]}
      />
      <TileGroup
        title="Cardinalidad"
        tiles={CARDINALITIES.map((cardinality) => ({
          name: cardinality.name,
          hint: cardinality.reading,
          glyph: cardinality.glyph,
          disabled: relationIndex === null,
          onClick: () => void api.edit('setCardinality', { index: relationIndex, side: 'b', cardinality: cardinality.id }),
        }))}
      />
      <TileGroup
        title="Tipo de relación"
        tiles={[
          { name: 'Identificante', hint: '--', glyph: 'M2 6h20', disabled: relationIndex === null, onClick: () => void api.edit('setIdentifying', { index: relationIndex, identifying: true }) },
          { name: 'No identificante', hint: '..', glyph: 'M2 6h20', dash: '3 3', disabled: relationIndex === null, onClick: () => void api.edit('setIdentifying', { index: relationIndex, identifying: false }) },
        ]}
      />
    </ElementsFrame>
  )
}
