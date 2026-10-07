import { useState } from 'react'
import { ArrowRight, ChevronDown, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { CommitInput, EmptyInspector, Field, Glyph, InspectorHeader, Section, Segmented } from './editorParts'
import { CARDINALITIES } from './diagramMeta'
import { selectionIs, type EditorApi } from './editorApi'
import type { Cardinality, ErEntity, ErKey, ErModel, ErRelation } from './mermaidEditorTypes'

/* Entity-relationship diagrams: inspector and floating menus (canvas board «Entidad-relación»). */

const KEYS: Array<{ id: ErKey; name: string }> = [
  { id: 'PK', name: 'Clave primaria' },
  { id: 'FK', name: 'Clave foránea' },
  { id: 'UK', name: 'Clave única' },
]
const TYPES: Array<{ id: 'yes' | 'no'; name: string }> = [
  { id: 'yes', name: 'Identificante' },
  { id: 'no', name: 'No identificante' },
]

const cardinality = (id: Cardinality) => CARDINALITIES.find((candidate) => candidate.id === id) ?? CARDINALITIES[0]

function EntityInspector({ api, entity }: { api: EditorApi<ErModel>; entity: ErEntity }) {
  return (
    <>
      <Section>
        <Field label="Nombre">
          <CommitInput value={entity.name} label="Nombre de la entidad" onCommit={(newName) => void api.edit('renameEntity', { name: entity.name, newName })} />
        </Field>
      </Section>
      <Section
        title="Atributos"
        action={<button type="button" className="mmd-icon-button" aria-label="Agregar atributo" onClick={() => void api.edit('addAttribute', { name: entity.name })}><Plus size={14} aria-hidden="true" /></button>}
      >
        {entity.attributes.length === 0 ? <span className="mmd-subtle">Sin atributos.</span> : null}
        {entity.attributes.map((attribute, index) => (
          <div key={`${attribute.line}-${attribute.name}`} className="mmd-member-row">
            <span style={{ width: 54, flexShrink: 0 }}>{attribute.typeName}</span>
            <span style={{ color: 'var(--color-heading-text)' }}>{attribute.name}</span>
            <div className="mmd-keys" role="group" aria-label={`Claves de ${attribute.name}`}>
              {KEYS.map((key) => (
                <button key={key.id} type="button" data-key={key.id} aria-pressed={attribute.key === key.id} title={key.name} aria-label={key.name} onClick={() => void api.edit('toggleKey', { name: entity.name, index, key: key.id })}>
                  {key.id}
                </button>
              ))}
            </div>
            <button type="button" className="mmd-icon-button" style={{ marginLeft: 0 }} aria-label={`Quitar ${attribute.name}`} onClick={() => void api.edit('deleteAttribute', { name: entity.name, index })}>
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
      </Section>
      <Section>
        <button type="button" className="mmd-dashed-button" onClick={() => api.startLink(entity.name)}><Plus size={14} aria-hidden="true" />Nueva relación</button>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteEntity', { name: entity.name }).then((done) => done && api.select(null))}><Trash2 size={14} aria-hidden="true" />Eliminar entidad</button>
      </Section>
    </>
  )
}

function CardinalityCards({ api, relation, side }: { api: EditorApi<ErModel>; relation: ErRelation; side: 'a' | 'b' }) {
  const current = side === 'a' ? relation.cardA : relation.cardB
  return (
    <div className="mmd-cards">
      {CARDINALITIES.map((option) => (
        <button key={option.id} type="button" className="mmd-card" style={{ justifyContent: 'flex-start' }} aria-pressed={current === option.id} onClick={() => void api.edit('setCardinality', { index: relation.index, side, cardinality: option.id })}>
          <span style={{ transform: side === 'a' ? 'scaleX(-1)' : undefined, display: 'inline-flex' }}><Glyph d={option.glyph} /></span>
          <span>{option.name}</span>
        </button>
      ))}
    </div>
  )
}

function RelationInspector({ api, relation }: { api: EditorApi<ErModel>; relation: ErRelation }) {
  return (
    <>
      <Section>
        <div className="mmd-chip-row">
          <button type="button" className="mmd-chip" onClick={() => api.select({ kind: 'entity', key: relation.a })}>{relation.a}</button>
          <span className="mmd-mono" style={{ color: 'var(--color-accent-text)', fontSize: 13, flexShrink: 0 }}>{relation.op}</span>
          <button type="button" className="mmd-chip" onClick={() => api.select({ kind: 'entity', key: relation.b })}>{relation.b}</button>
        </div>
      </Section>
      <Section>
        <Field label={`Lado ${relation.a}`}><CardinalityCards api={api} relation={relation} side="a" /></Field>
        <Field label={`Lado ${relation.b}`}><CardinalityCards api={api} relation={relation} side="b" /></Field>
        <Field label="Tipo">
          <Segmented label="Tipo de relación" options={TYPES} value={relation.identifying ? 'yes' : 'no'} onChange={(value) => void api.edit('setIdentifying', { index: relation.index, identifying: value === 'yes' })} />
        </Field>
        <Field label="Verbo">
          <CommitInput value={relation.verb} label="Verbo" placeholder="Sin verbo" onCommit={(verb) => void api.edit('setVerb', { index: relation.index, verb })} />
        </Field>
        <Field label="Cómo se lee">
          <div className="mmd-syntax" style={{ whiteSpace: 'normal', fontFamily: 'inherit', lineHeight: 1.6 }}>
            Cada {relation.a} → {cardinality(relation.cardB).reading} {relation.b}<br />
            Cada {relation.b} → {cardinality(relation.cardA).reading} {relation.a}
          </div>
        </Field>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteRelation', { index: relation.index }).then((done) => done && api.select(null))}><Trash2 size={14} aria-hidden="true" />Eliminar relación</button>
      </Section>
    </>
  )
}

export function ErInspector({ api }: { api: EditorApi<ErModel> }) {
  const name = selectionIs(api.selection, 'entity')
  const index = selectionIs(api.selection, 'relation')
  const entity = name ? api.model.entities.find((candidate) => candidate.name === name) : undefined
  const relation = index !== null ? api.model.relations[Number(index)] : undefined
  return (
    <>
      <InspectorHeader title={relation ? 'Relación' : entity ? 'Entidad' : 'Propiedades'} onClear={entity || relation ? () => api.select(null) : undefined} />
      {entity ? <EntityInspector key={entity.name} api={api} entity={entity} />
        : relation ? <RelationInspector key={relation.index} api={api} relation={relation} />
          : (
            <EmptyInspector
              text="Hacé clic en una entidad o en una relación para editarla."
              counts={[{ label: 'Entidades', value: api.model.entities.length }, { label: 'Relaciones', value: api.model.relations.length }]}
            />
          )}
    </>
  )
}

export function ErContextMenu({ api }: { api: EditorApi<ErModel> }) {
  const [open, setOpen] = useState<'a' | 'b' | 'more' | null>(null)
  const name = selectionIs(api.selection, 'entity')
  const index = selectionIs(api.selection, 'relation')
  const entity = name ? api.model.entities.find((candidate) => candidate.name === name) : undefined
  const relation = index !== null ? api.model.relations[Number(index)] : undefined
  if (entity) {
    return (
      <>
        <button type="button" className="mmd-context-text" onClick={() => void api.edit('addAttribute', { name: entity.name })}><Plus size={14} aria-hidden="true" />Atributo</button>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-context-text" aria-label="Nueva relación" onClick={() => api.startLink(entity.name)}><ArrowRight size={15} aria-hidden="true" />Relación</button>
        <div className="mmd-menu">
          <button type="button" className="mmd-icon-button" aria-label="Más acciones" aria-expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}><MoreHorizontal size={15} aria-hidden="true" /></button>
          {open === 'more' ? (
            <div className="mmd-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('deleteEntity', { name: entity.name }).then((done) => done && api.select(null)) }}><Trash2 size={14} aria-hidden="true" />Eliminar</button>
            </div>
          ) : null}
        </div>
      </>
    )
  }
  if (relation) {
    const sideMenu = (side: 'a' | 'b') => {
      const current = cardinality(side === 'a' ? relation.cardA : relation.cardB)
      const owner = side === 'a' ? relation.a : relation.b
      return (
        <div className="mmd-menu">
          <button type="button" className="mmd-context-text" aria-haspopup="menu" aria-expanded={open === side} title={`Cardinalidad en ${owner}`} aria-label={`Cardinalidad en ${owner}: ${current.name}`} onClick={() => setOpen(open === side ? null : side)}>
            <span style={{ transform: side === 'a' ? 'scaleX(-1)' : undefined, display: 'inline-flex' }}><Glyph d={current.glyph} /></span><ChevronDown size={12} aria-hidden="true" />
          </button>
          {open === side ? (
            <div className="mmd-menu-list" role="menu" aria-label={`Cardinalidad en ${owner}`}>
              {CARDINALITIES.map((option) => (
                <button key={option.id} type="button" role="menuitemradio" aria-checked={current.id === option.id} onClick={() => { setOpen(null); void api.edit('setCardinality', { index: relation.index, side, cardinality: option.id }) }}>
                  <Glyph d={option.glyph} />{option.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    return (
      <>
        {sideMenu('a')}
        <div className="mmd-segmented" role="group" aria-label="Tipo de línea" style={{ padding: 2 }}>
          {TYPES.map((type) => (
            <button key={type.id} type="button" aria-pressed={relation.identifying === (type.id === 'yes')} aria-label={type.name} title={type.name} onClick={() => void api.edit('setIdentifying', { index: relation.index, identifying: type.id === 'yes' })}>
              <Glyph d="M2 6h18" width={22} dash={type.id === 'no' ? '3 3' : undefined} />
            </button>
          ))}
        </div>
        {sideMenu('b')}
        <span className="mmd-bar-divider" />
        <CommitInput value={relation.verb} label="Verbo" placeholder="Verbo…" onCommit={(verb) => void api.edit('setVerb', { index: relation.index, verb })} />
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-icon-button" data-danger="true" aria-label="Eliminar" title="Eliminar" onClick={() => void api.edit('deleteRelation', { index: relation.index }).then((done) => done && api.select(null))}><Trash2 size={15} aria-hidden="true" /></button>
      </>
    )
  }
  return null
}
